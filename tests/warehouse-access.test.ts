import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { request } from "node:http";
import express from "express";
import { createApp } from "../server/app";
import { openDatabase } from "../server/db";
import { InventoryStore } from "../server/store";
import { hashPassword, clerkSecurity } from "../server/security";
import { loadConfig } from "../server/config";
import { warehouseAccess } from "../server/warehouse-access";

const token = "a".repeat(64),
  tokenHash = createHash("sha256").update(token).digest("hex");
// Native fetch can replace Host on this Node version; test the actual host gate
// with an HTTP client that sends the supplied header unchanged.
function rawFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: options.method || "GET", headers: options.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers))
            for (const item of Array.isArray(value)
              ? value
              : value === undefined
                ? []
                : [value])
              headers.append(key, item);
          resolve(
            new Response(Buffer.concat(chunks).toString(), {
              status: res.statusCode!,
              headers,
            }),
          );
        });
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}
test("warehouse access configuration requires an expiry and preserves production account authentication", () => {
  assert.throws(
    () => loadConfig({ WAREHOUSE_ACCESS_TOKEN_SHA256: tokenHash }),
    /expiry/,
  );
  assert.throws(() =>
    loadConfig({
      WAREHOUSE_ACCESS_TOKEN_SHA256: "bad",
      WAREHOUSE_ACCESS_EXPIRES_AT: "tomorrow",
    }),
  );
  assert.throws(
    () =>
      loadConfig({
        APP_MODE: "production",
        WAREHOUSE_ACCESS_TOKEN_SHA256: tokenHash,
        WAREHOUSE_ACCESS_EXPIRES_AT: "2030-01-01T00:00:00Z",
      }),
    /authentication/,
  );
  assert.equal(loadConfig({}).warehouseAccess, undefined);
  // An expired link must not stop the normal authenticated server from starting.
  assert.equal(
    loadConfig({
      WAREHOUSE_ACCESS_TOKEN_SHA256: tokenHash,
      WAREHOUSE_ACCESS_EXPIRES_AT: "2020-01-01T00:00:00Z",
    }).warehouseAccess?.tokenHash,
    tokenHash,
  );
});

test("shared links allow operator work, require a count name, and expire without exposing admin functions", async () => {
  const db = openDatabase(":memory:"),
    store = new InventoryStore(db);
  db.prepare(
    "INSERT INTO products(id,sku,title,updatedAt) VALUES(?,?,?,?)",
  ).run("fixture", "00123", "Fixture only", new Date().toISOString());
  const bin = store.createBin({
    productId: "fixture",
    binLabel: "Fixture bin",
    unitWeightOz: 2,
    emptyBinWeightOz: 16,
    location: "QA",
    notes: "",
  });
  let now = Date.parse("2026-09-10T18:00:00Z");
  const expiry = new Date(now + 3600000).toISOString();
  const app = createApp(db, {
    publicOrigin: "https://inventory.example.com",
    now: () => now,
    users: [
      {
        username: "fixtureadmin",
        displayName: "Fixture admin",
        role: "admin",
        passwordHash: await hashPassword("fixture-only-password"),
      },
    ],
    warehouseAccess: { tokenHash, expiresAt: expiry },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const root = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (
    path: string,
    cookie = "",
    body?: unknown,
    extra: Record<string, string> = {},
    method = body === undefined ? "GET" : "POST",
  ) =>
    rawFetch(root + path, {
      method,
      redirect: "manual",
      headers: {
        Host: "inventory.example.com",
        Origin: "https://inventory.example.com",
        Cookie: cookie,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    assert.equal((await call("/api/products")).status, 401);
    assert.equal((await call("/warehouse")).status, 200);
    assert.equal(
      (await call("/warehouse-access", "", { key: "bad" })).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/warehouse-access",
          "",
          { key: token },
          { Origin: "https://other.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/warehouse-access",
          "",
          { key: token },
          { Host: "other.example" },
        )
      ).status,
      403,
    );
    const grant = await call("/warehouse-access", "", { key: token });
    assert.equal(grant.status, 200);
    const setCookie = grant.headers.get("set-cookie")!;
    assert.match(setCookie, /__Host-iboltscan-warehouse=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Max-Age=3600/);
    const cookie = setCookie.split(";")[0];
    const status = (await (await call("/api/status", cookie)).json()) as any;
    assert.equal(status.identity.role, "operator");
    assert.equal(status.identity.accessMode, "warehouse");
    assert.equal(status.identity.authenticated, false);
    const config = (await (await call("/auth-config", cookie)).json()) as any;
    assert.equal(config.provider, "warehouse");
    assert.equal(config.clerkPublishableKey, null);
    assert.equal((await call("/api/backup", cookie, {})).status, 403);
    assert.equal(
      (await call("/api/bins/" + bin.id, cookie, undefined, {}, "DELETE"))
        .status,
      403,
    );
    const count = {
      binId: bin.id,
      totalWeight: 36,
      weightUnit: "oz",
      roundingMode: "nearest",
      save: true,
      requestId: randomUUID(),
      expectedBinUpdatedAt: bin.updatedAt,
    };
    assert.equal((await call("/api/calculate", cookie, count)).status, 400);
    assert.equal(store.counts().length, 0);
    const saved = await call("/api/calculate", cookie, {
      ...count,
      countedBy: "Fixture operator",
    });
    assert.equal(saved.status, 200);
    assert.equal(store.counts()[0].actorId, "warehouse-link");
    assert.equal(store.counts()[0].countedBy, "Fixture operator");
    assert.equal(
      (
        await call("/api/products", cookie, undefined, {
          Origin: "https://other.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (await call("/api/products", cookie.replace(token, "b".repeat(64))))
        .status,
      401,
    );
    const exit = await call("/warehouse-exit", cookie, {});
    assert.equal(exit.status, 303);
    assert.match(exit.headers.get("set-cookie")!, /Max-Age=0/);
    now += 3600000;
    assert.equal((await call("/api/products", cookie)).status, 401);
    assert.equal(
      (await call("/warehouse-access", "", { key: token })).status,
      403,
    );
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});

test("warehouse cookies pass the Clerk gate without an account but keep origin and host checks", async () => {
  const app = express(),
    now = Date.now();
  app.use(
    warehouseAccess(
      { tokenHash, expiresAt: new Date(now + 3600000).toISOString() },
      { publicOrigin: "https://inventory.example.com" },
    ),
  );
  app.use(
    clerkSecurity({
      publicOrigin: "https://inventory.example.com",
      getUserId: () => undefined,
      resolveUser: async () => {
        throw new Error("Guest access must not resolve a Clerk account.");
      },
    }),
  );
  app.get("/api/whoami", (_req, res) => res.json(res.locals.identity));
  app.get("/", (_req, res) => res.send("Inventory"));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const root = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const headers = {
      Host: "inventory.example.com",
      Cookie: `__Host-iboltscan-warehouse=${token}`,
    };
    const identity = (await (
      await rawFetch(root + "/api/whoami", { headers })
    ).json()) as any;
    assert.equal(identity.role, "operator");
    assert.equal(identity.accessMode, "warehouse");
    assert.equal(
      await (await rawFetch(root + "/", { headers })).text(),
      "Inventory",
    );
    assert.equal(
      (
        await rawFetch(root + "/api/whoami", {
          headers: { ...headers, Host: "other.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await rawFetch(root + "/api/whoami", {
          headers: { ...headers, Origin: "https://other.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await rawFetch(root + "/api/whoami", {
          headers: { Host: headers.Host },
        })
      ).status,
      401,
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});
