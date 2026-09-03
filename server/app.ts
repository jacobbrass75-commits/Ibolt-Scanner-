import express from "express";
import { z } from "zod";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { InventoryDatabase } from "./db";
import { InventoryStore } from "./store";

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
  options: { password?: string; publicOrigin?: string } = {},
) {
  const app = express(),
    store = new InventoryStore(db);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress || "",
    );
    const host = req.headers.host || "";
    const allowedHost =
      /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ||
      (options.publicOrigin && host === new URL(options.publicOrigin).host);
    if (!allowedHost) {
      res
        .status(403)
        .send("Unrecognized host. Configure PUBLIC_ORIGIN for this server.");
      return;
    }
    if (!options.password && !local) {
      res.status(403).send("Remote access requires ACCESS_PASSWORD.");
      return;
    }
    if (options.password) {
      const auth = req.headers.authorization || "";
      const credentials = auth.startsWith("Basic ")
        ? Buffer.from(auth.slice(6), "base64").toString()
        : "";
      const provided = credentials.slice(credentials.indexOf(":") + 1);
      if (
        !credentials.includes(":") ||
        !timingSafeEqual(
          createHash("sha256").update(provided).digest(),
          createHash("sha256").update(options.password).digest(),
        )
      ) {
        res.setHeader(
          "WWW-Authenticate",
          'Basic realm="iBolt Inventory", charset="UTF-8"',
        );
        res.status(401).send("Inventory sign-in required.");
        return;
      }
    }
    const origin = req.headers.origin;
    const allowedOrigin = options.publicOrigin || `http://${host}`;
    if (origin && origin !== allowedOrigin) {
      res
        .status(403)
        .json({ error: "Requests must come from this inventory app." });
      return;
    }
    if (req.headers["sec-fetch-site"] === "cross-site") {
      res.status(403).end();
      return;
    }
    next();
  });
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
  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", app: "iboltscan" }),
  );
  app.get("/api/status", (_req, res) => {
    const products = store.products();
    res.json({
      products: products.length,
      verified: products.filter((p) => p.weightStatus === "verified").length,
      needsWeight: products.filter(
        (p) => p.weightStatus === "missing" || p.weightStatus === "conflict",
      ).length,
      bins: store.bins().length,
      counts: store.counts().length,
      imports: db
        .prepare(
          "SELECT sourceFile,summary,createdAt FROM imports ORDER BY id DESC",
        )
        .all(),
      publicOrigin: options.publicOrigin || null,
    });
  });
  app.get("/api/products", (_req, res) => res.json(store.products()));
  app.patch(
    "/api/products/:id",
    route((req, res) =>
      res.json(
        store.updateProduct(
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
    route((req, res) => {
      const input = z
        .object({
          ...binFields,
          productId: text.min(1),
          weightsConfirmed: z.literal(true),
        })
        .strict()
        .parse(req.body);
      res.status(201).json(store.createBin(input));
    }),
  );
  app.patch(
    "/api/bins/:id",
    route((req, res) =>
      res.json(
        store.updateBin(
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
    route((req, res) => res.json(store.archiveBin(req.params.id))),
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
      res.json(store.calculate(input));
    }),
  );
  app.get("/api/counts", (_req, res) => res.json(store.counts()));
  app.get(
    "/api/export/:kind",
    route((req, res) => {
      const kind = z
        .enum(["products", "bins", "counts"])
        .parse(req.params.kind);
      const rows: any[] =
        kind === "products"
          ? store.products().map(({ aliases, source, ...p }) => p)
          : kind === "bins"
            ? store.bins(true)
            : store.counts();
      const headers = rows.length ? Object.keys(rows[0]) : ["id"];
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="inventory-${kind}.csv"`,
      );
      res
        .type("text/csv")
        .send(
          "\uFEFF" +
            [
              headers.map(csvCell).join(","),
              ...rows.map((r) => headers.map((k) => csvCell(r[k])).join(",")),
            ].join("\r\n"),
        );
    }),
  );
  app.post(
    "/api/backup",
    route(async (_req, res) => {
      mkdirSync("backups", { recursive: true });
      const file = path.resolve(
        "backups",
        `inventory-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.sqlite`,
      );
      await db.backup(file);
      res.download(file);
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
        res
          .status(400)
          .json({
            error: error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          });
      else
        res
          .status(/not found/i.test(error.message) ? 404 : 400)
          .json({ error: error.message || "Request failed." });
    },
  );
  return app;
}
