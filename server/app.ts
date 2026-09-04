import express from "express";
import { z } from "zod";
import { clerkMiddleware, createClerkClient } from "@clerk/express";
import { clerkProxy } from "./clerk-proxy";
import { once } from "node:events";
import path from "node:path";
import type { InventoryDatabase } from "./db";
import { InventoryStore } from "./store";
import { clerkSecurity, security, requireRole } from "./security";
import type { AuthUser, ClerkConfig, Identity } from "./config";
import { InventoryError } from "./errors";
import { createBackup } from "./backups";

const text = z.string().trim().max(2000);
const positive = z.number().finite().positive().max(1e9);
const nonnegative = z.number().finite().min(0).max(1e12);
const binFields = {
  binLabel: text.min(1).max(160),
  unitWeightOz: positive,
  emptyBinWeightOz: nonnegative,
  location: text.default(""),
  notes: text.default(""),
};
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function createApp(
  db: InventoryDatabase,
  options: {
    users?: AuthUser[];
    clerk?: ClerkConfig;
    password?: string;
    publicOrigin?: string;
    development?: boolean;
    backupDir?: string;
    now?: () => number;
    maxFailures?: number;
  } = {},
) {
  const app = express(),
    store = new InventoryStore(db);
  app.disable("x-powered-by");
  app.use("/login", express.urlencoded({ extended: false, limit: "2kb" }));
  if (options.clerk) {
    const client = createClerkClient({ secretKey: options.clerk.secretKey });
    if (options.clerk.proxyUrl)
      app.use(clerkProxy({ ...options.clerk, proxyUrl: options.clerk.proxyUrl }));
    app.use(
      clerkMiddleware({
        clerkClient: client,
        publishableKey: options.clerk.publishableKey,
        secretKey: options.clerk.secretKey,
        proxyUrl: options.clerk.proxyUrl,
        authorizedParties: options.publicOrigin
          ? [options.publicOrigin]
          : undefined,
      }),
    );
    app.use(
      clerkSecurity({
        publicOrigin: options.publicOrigin,
        development: options.development,
        resolveUser: (userId) => client.users.getUser(userId),
      }),
    );
  } else app.use(security(options));
  app.get("/auth-config", (_req, res) =>
    res.json({
      provider: options.clerk ? "clerk" : "local",
      clerkPublishableKey: options.clerk?.publishableKey || null,
      clerkProxyUrl: options.clerk?.proxyUrl || null,
    }),
  );
  app.use(express.json({ limit: "200kb" }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const route =
    (
      fn: (req: express.Request, res: express.Response) => unknown,
    ): express.RequestHandler =>
    (req, res, next) => {
      try {
        Promise.resolve(fn(req, res)).catch(next);
      } catch (e) {
        next(e);
      }
    };
  const actingStore = (res: express.Response) =>
    new InventoryStore(db, (res.locals.identity as Identity).username);
  app.get(
    "/healthz",
    route((_req, res) => {
      db.prepare("SELECT 1").get();
      res.json({ status: "ok" });
    }),
  );
  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", app: "iboltscan" }),
  );
  app.get("/api/status", (_req, res) => {
    const products = store.products();
    res.json({
      products: products.length,
      identity: res.locals.identity,
      verified: products.filter((p) => p.weightStatus === "verified").length,
      needsWeight: products.filter(
        (p) => p.weightStatus === "missing" || p.weightStatus === "conflict",
      ).length,
      bins: store.bins().length,
      counts: store.countTotal(),
      imports: db
        .prepare(
          "SELECT sourceFile,summary,createdAt FROM imports ORDER BY id DESC LIMIT 20",
        )
        .all(),
      publicOrigin: options.publicOrigin || null,
    });
  });
  app.get("/api/products", (_req, res) => res.json(store.products()));
  app.patch(
    "/api/products/:id",
    requireRole("admin", "operator"),
    route((req, res) =>
      res.json(
        actingStore(res).updateProduct(
          req.params.id,
          z
            .object({
              unitWeightOz: positive,
              barcode: text.max(200),
              category: text.max(200),
              weightNote: text,
              expectedUpdatedAt: text.min(1),
            })
            .strict()
            .parse(req.body),
        ),
      ),
    ),
  );
  app.get("/api/bins", (req, res) =>
    res.json(store.bins(req.query.archived === "true")),
  );
  app.post(
    "/api/bins",
    requireRole("admin", "operator"),
    route((req, res) => {
      const input = z
        .object({
          ...binFields,
          productId: text.min(1),
          weightsConfirmed: z.literal(true),
        })
        .strict()
        .parse(req.body);
      res.status(201).json(actingStore(res).createBin(input));
    }),
  );
  app.patch(
    "/api/bins/:id",
    requireRole("admin", "operator"),
    route((req, res) =>
      res.json(
        actingStore(res).updateBin(
          req.params.id,
          z
            .object({
              ...binFields,
              expectedUpdatedAt: text.min(1),
              weightsConfirmed: z.literal(true),
            })
            .strict()
            .parse(req.body),
        ),
      ),
    ),
  );
  app.delete(
    "/api/bins/:id",
    requireRole("admin"),
    route((req, res) => res.json(actingStore(res).archiveBin(req.params.id))),
  );
  app.get(
    "/api/lookup",
    route((req, res) =>
      res.json(store.lookup(z.string().min(1).max(2048).parse(req.query.code))),
    ),
  );
  app.post(
    "/api/calculate",
    route((req, res) => {
      const input = z
        .object({
          binId: text.min(1),
          totalWeight: nonnegative,
          weightUnit: z.enum(["oz", "lb", "g", "kg"]),
          roundingMode: z.enum(["nearest", "floor", "ceil"]),
          save: z.boolean().default(false),
          requestId: z.string().uuid().optional(),
          expectedBinUpdatedAt: text.optional(),
          countedBy: text.default(""),
          notes: text.default(""),
        })
        .strict()
        .parse(req.body);
      const identity = res.locals.identity as Identity;
      if (input.save && identity.role === "viewer")
        throw new InventoryError("Your account cannot save counts.", 403);
      if (identity.authenticated) input.countedBy = identity.displayName;
      res.json(actingStore(res).calculate(input));
    }),
  );
  app.get(
    "/api/counts",
    route((req, res) => {
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(200).default(100),
          before: z.string().uuid().optional(),
        })
        .strict()
        .parse(req.query);
      res.json(store.countPage(query.limit, query.before));
    }),
  );
  app.get(
    "/api/export/:kind",
    route(async (req, res) => {
      const kind = z
        .enum(["products", "bins", "counts"])
        .parse(req.params.kind);
      const rows: Iterable<any> =
        kind === "products"
          ? store.products().map(({ aliases, source, ...p }) => p)
          : kind === "bins"
            ? store.bins(true)
            : store.exportCounts();
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="inventory-${kind}.csv"`,
      );
      res.type("text/csv");
      let headers: string[] | undefined;
      for (const row of rows) {
        if (res.destroyed) return;
        if (!headers) {
          headers = Object.keys(row);
          res.write("\uFEFF" + headers.map(csvCell).join(",") + "\r\n");
        }
        if (!res.write(headers.map((k) => csvCell(row[k])).join(",") + "\r\n"))
          await once(res, "drain");
      }
      if (!headers) res.write('\uFEFF"id"\r\n');
      res.end();
    }),
  );
  let backupRunning = false;
  let lastBackupAt = 0;
  app.post(
    "/api/backup",
    requireRole("admin"),
    route(async (_req, res) => {
      if (backupRunning || Date.now() - lastBackupAt < 60000) {
        res.setHeader("Retry-After", "60");
        throw new InventoryError(
          "A backup was just requested. Wait a minute before requesting another.",
          429,
        );
      }
      backupRunning = true;
      try {
        const result = await createBackup(
          db,
          options.backupDir || path.resolve("backups"),
        );
        lastBackupAt = Date.now();
        res.setHeader("X-Backup-SHA256", result.manifest.sha256);
        res.download(result.filename);
      } finally {
        backupRunning = false;
      }
    }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Inventory endpoint not found." }),
  );
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError)
        res.status(400).json({
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
      else if (error instanceof InventoryError)
        res.status(error.status).json({ error: error.message });
      else if (error.type === "entity.parse.failed")
        res.status(400).json({ error: "Invalid JSON request." });
      else if (error.type === "entity.too.large")
        res.status(413).json({ error: "Request is too large." });
      else {
        console.error(
          "Inventory request failed",
          error.code || error.name || "Error",
        );
        if (res.headersSent) {
          res.destroy();
          return;
        }
        res.status(error.code === "SQLITE_BUSY" ? 503 : 500).json({
          error:
            "The inventory service could not complete this request. Retry shortly; contact the administrator if it persists.",
        });
      }
    },
  );
  return app;
}
