import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  utimes,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDatabase, SCHEMA_VERSION } from "../server/db";
import { createApp } from "../server/app";
import { InventoryStore } from "../server/store";
import {
  clerkSecurity,
  hashPassword,
  identityFromClerkUser,
  verifyPassword,
} from "../server/security";
import { loadConfig, type AuthUser, type Identity } from "../server/config";
import {
  createBackup,
  restoreToNewFile,
  inspectBackup,
  pruneBackups,
} from "../server/backups";

const password = "fixture-only-long-password";
test("backup retention keeps 24 complete snapshots and ignores unrelated or incomplete files", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "iboltscan-retention-test-"),
  );
  const old = new Date("2020-01-01T00:00:00.000Z");
  try {
    for (let i = 0; i < 26; i++) {
      const filename = path.join(
        directory,
        `inventory-2020-01-01T00-00-00-${String(i).padStart(3, "0")}Z-${i.toString(16).padStart(8, "0")}.sqlite`,
      );
      await writeFile(filename, "retention fixture");
      await writeFile(
        filename + ".json",
        JSON.stringify({
          sha256: "a".repeat(64),
          createdAt: old.toISOString(),
        }),
      );
      await utimes(filename, old, old);
    }
    await writeFile(path.join(directory, "other.sqlite"), "unrelated");
    await writeFile(
      path.join(directory, "inventory-unfinished.sqlite.partial"),
      "incomplete",
    );
    assert.equal(await pruneBackups(directory), 2);
    const names = await readdir(directory);
    assert.equal(
      names.filter((n) => n.startsWith("inventory-") && n.endsWith(".sqlite"))
        .length,
      24,
    );
    assert.ok(names.includes("other.sqlite"));
    assert.ok(names.includes("inventory-unfinished.sqlite.partial"));
    assert.equal(await pruneBackups(directory), 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
function seed(db: ReturnType<typeof openDatabase>) {
  db.prepare(
    "INSERT INTO products(id,sku,title,updatedAt) VALUES(?,?,?,?)",
  ).run("p1", "00123", "Fixture part", "2026-01-01T00:00:00.000Z");
  const store = new InventoryStore(db, "fixture");
  const bin = store.createBin({
    productId: "p1",
    binLabel: "Fixture bin",
    unitWeightOz: 2,
    emptyBinWeightOz: 16,
    location: "QA",
    notes: "",
  });
  return { store, bin };
}
async function users(): Promise<AuthUser[]> {
  const passwordHash = await hashPassword(password);
  return ["admin", "operator", "viewer"].map((role) => ({
    username: role,
    displayName: role + " name",
    role: role as AuthUser["role"],
    passwordHash,
  }));
}
function auth(username: string, value = password) {
  return "Basic " + Buffer.from(username + ":" + value).toString("base64");
}

test("named accounts enforce roles, server identity, conflict status and bounded history", async () => {
  const db = openDatabase(":memory:");
  const { bin } = seed(db);
  const server = createApp(db, {
    users: await users(),
    publicOrigin: "https://inventory.example.com",
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const root = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (
    url: string,
    username = "operator",
    body?: unknown,
    method = body ? "POST" : "GET",
  ) =>
    fetch(root + url, {
      method,
      headers: {
        Authorization: auth(username),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const base = {
    binId: bin.id,
    totalWeight: 36,
    weightUnit: "oz",
    roundingMode: "nearest",
    countedBy: "spoofed name",
    save: false,
  };
  try {
    assert.equal((await fetch(root + "/api/status")).status, 401);
    const health = await fetch(root + "/healthz");
    assert.deepEqual(await health.json(), { status: "ok" });
    assert.match(
      health.headers.get("content-security-policy") || "",
      /default-src 'self'/,
    );
    const status = (await (await call("/api/status")).json()) as any;
    assert.equal(status.identity.username, "operator");
    assert.equal(status.identity.passwordHash, undefined);
    assert.equal(
      (await call("/api/products/p1", "viewer", {}, "PATCH")).status,
      403,
    );
    assert.equal(
      (await call("/api/bins/" + bin.id, "operator", undefined, "DELETE"))
        .status,
      403,
    );
    assert.equal((await call("/api/backup", "operator", {})).status, 403);
    assert.equal(
      (await call("/api/calculate", "viewer", { ...base, save: true })).status,
      403,
    );
    const preview = (await (
      await call("/api/calculate", "viewer", base)
    ).json()) as any;
    assert.equal(preview.quantity, 10);
    const saved = {
      ...base,
      save: true,
      requestId: randomUUID(),
      expectedBinUpdatedAt: bin.updatedAt,
    };
    const response = await call("/api/calculate", "operator", saved);
    assert.equal(response.status, 200);
    const result = (await response.json()) as any;
    assert.equal(result.count.actorId, "operator");
    assert.equal(result.count.countedBy, "operator name");
    assert.equal((await call("/api/calculate", "operator", saved)).status, 200);
    assert.equal((await call("/api/calculate", "admin", saved)).status, 409);
    assert.equal(
      (
        await call("/api/calculate", "operator", {
          ...saved,
          requestId: randomUUID(),
        })
      ).status,
      409,
    );
    let latest = result.bin;
    for (let i = 0; i < 4; i++) {
      const r = (await (
        await call("/api/calculate", "operator", {
          ...saved,
          requestId: randomUUID(),
          expectedBinUpdatedAt: latest.updatedAt,
        })
      ).json()) as any;
      latest = r.bin;
    }
    const page = (await (await call("/api/counts?limit=2")).json()) as any;
    const next = (await (
      await call("/api/counts?limit=2&before=" + page.nextCursor)
    ).json()) as any;
    assert.equal(page.items.length, 2);
    assert.equal(page.total, 5);
    assert.equal(next.items.length, 2);
    assert.ok(
      !page.items.some((c: any) => next.items.some((n: any) => n.id === c.id)),
    );
    assert.equal((await call("/api/counts?limit=99999")).status, 400);
    assert.equal(
      (await (await call("/api/export/counts")).text())
        .split("\r\n")
        .filter(Boolean).length,
      6,
    );
    const update = await call(
      "/api/products/p1",
      "operator",
      {
        unitWeightOz: 2,
        barcode: "0007",
        category: "",
        weightNote: "Measured",
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      },
      "PATCH",
    );
    assert.equal(update.status, 200);
    assert.equal(
      (
        db
          .prepare("SELECT actorId FROM audit WHERE kind='product_measurement'")
          .get() as any
      ).actorId,
      "operator",
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});

test("password verification and failed sign-in throttling recover after expiry", async () => {
  const accounts = await users();
  assert.ok(await verifyPassword(password, accounts[0].passwordHash));
  assert.equal(await verifyPassword("wrong", accounts[0].passwordHash), false);
  let now = Date.now();
  const db = openDatabase(":memory:");
  const server = createApp(db, {
    users: accounts,
    now: () => now,
    maxFailures: 2,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const root = `http://127.0.0.1:${(server.address() as any).port}/api/status`;
  try {
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await fetch(root, {
            headers: { Authorization: auth("admin", "wrong") },
          })
        ).status,
        401,
      );
    assert.equal(
      (await fetch(root, { headers: { Authorization: auth("admin") } })).status,
      429,
    );
    now += 901000;
    assert.equal(
      (await fetch(root, { headers: { Authorization: auth("admin") } })).status,
      200,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});

test("online backup restores exact records; checksum errors and existing destinations are rejected", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "iboltscan-backup-test-"),
  );
  let db: ReturnType<typeof openDatabase> | undefined;
  try {
    db = openDatabase(path.join(directory, "live.sqlite"));
    const { store, bin } = seed(db);
    const input = {
      binId: bin.id,
      totalWeight: 36,
      weightUnit: "oz" as const,
      roundingMode: "nearest" as const,
      save: true,
      requestId: randomUUID(),
      expectedBinUpdatedAt: bin.updatedAt,
      countedBy: "Fixture",
      notes: "Known 10",
    };
    store.calculate(input);
    const backup = await createBackup(db, path.join(directory, "backups"));
    assert.equal(backup.manifest.totals.counts, 1);
    assert.equal(backup.manifest.schema, SCHEMA_VERSION);
    const destination = path.join(directory, "restored.sqlite");
    await assert.rejects(
      restoreToNewFile(backup.filename, destination, "0".repeat(64)),
      /checksum/,
    );
    await restoreToNewFile(
      backup.filename,
      destination,
      backup.manifest.sha256,
    );
    await assert.rejects(
      restoreToNewFile(backup.filename, destination, backup.manifest.sha256),
      /already exists/,
    );
    db.close();
    db = undefined;
    const restored = openDatabase(destination);
    try {
      const replay = new InventoryStore(restored, "fixture").calculate(input);
      assert.equal(replay.count?.quantity, 10);
      assert.equal(new InventoryStore(restored).countTotal(), 1);
    } finally {
      restored.close();
    }
    assert.equal(inspectBackup(destination).totals.counts, 1);
    const bytes = await readFile(backup.filename);
    bytes[100] ^= 1;
    await writeFile(path.join(directory, "bad.sqlite"), bytes);
    assert.throws(() => inspectBackup(path.join(directory, "bad.sqlite")));
  } finally {
    db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("v1 migration preserves counts and marks legacy actors; future schemas are refused without mutation", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "iboltscan-schema-test-"),
  );
  const filename = path.join(directory, "v1.sqlite");
  try {
    let db = openDatabase(filename);
    const { store, bin } = seed(db);
    store.calculate({
      binId: bin.id,
      totalWeight: 36,
      weightUnit: "oz",
      roundingMode: "nearest",
      save: true,
      requestId: randomUUID(),
      expectedBinUpdatedAt: bin.updatedAt,
      countedBy: "Earlier operator",
      notes: "",
    });
    db.exec(
      "ALTER TABLE counts DROP COLUMN actorId; ALTER TABLE audit DROP COLUMN actorId; PRAGMA user_version=1",
    );
    db.close();
    db = openDatabase(filename);
    assert.equal(new InventoryStore(db).counts()[0].actorId, "legacy");
    assert.equal(
      new InventoryStore(db).counts()[0].countedBy,
      "Earlier operator",
    );
    db.pragma("user_version = 999");
    db.close();
    assert.throws(() => openDatabase(filename), /newer than/);
    const verify = new Database(filename, { readonly: true });
    try {
      assert.equal(verify.pragma("user_version", { simple: true }), 999);
      assert.equal(
        (verify.prepare("SELECT count(*) n FROM counts").get() as any).n,
        1,
      );
    } finally {
      verify.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production configuration fails closed without named accounts and persistent paths", () => {
  assert.throws(() => loadConfig({ APP_MODE: "production" }), /authentication/);
  assert.throws(
    () => loadConfig({ PUBLIC_ORIGIN: "http://example.com" }),
    /HTTPS/,
  );
  assert.throws(
    () => loadConfig({ PUBLIC_ORIGIN: "https://example.com/path" }),
    /without a path/,
  );
  assert.throws(() => loadConfig({ HOST: "0.0.0.0" }), /authentication/);
  assert.equal(loadConfig({}).host, "127.0.0.1");
  assert.throws(
    () => loadConfig({ CLERK_PUBLISHABLE_KEY: "pk_test_fixture" }),
    /configured together/,
  );
  const clerk = loadConfig({
    CLERK_PUBLISHABLE_KEY: "pk_test_fixture",
    CLERK_SECRET_KEY: "sk_test_fixture",
    PUBLIC_ORIGIN: "https://inventory.example.com",
    CLERK_PROXY_URL: "https://inventory.example.com/__clerk/",
  }).clerk;
  assert.equal(clerk?.publishableKey, "pk_test_fixture");
  assert.equal(clerk?.secretKey, "sk_test_fixture");
  assert.equal(clerk?.proxyUrl, "https://inventory.example.com/__clerk");
  assert.throws(
    () =>
      loadConfig({
        CLERK_PUBLISHABLE_KEY: "pk_test_fixture",
        CLERK_SECRET_KEY: "sk_test_fixture",
        PUBLIC_ORIGIN: "https://inventory.example.com",
        CLERK_PROXY_URL: "https://clerk.example.com/__clerk",
      }),
    /PUBLIC_ORIGIN host/,
  );
  assert.throws(
    () =>
      loadConfig({
        CLERK_PROXY_URL: "https://inventory.example.com/__clerk",
      }),
    /requires Clerk authentication keys/,
  );
});

test("Clerk identities default to operator and accept only administrator-set roles", () => {
  assert.deepEqual(
    identityFromClerkUser({
      id: "user_fixture",
      fullName: "Office Operator",
      publicMetadata: {},
    }),
    {
      username: "user_fixture",
      displayName: "Office Operator",
      role: "operator",
      authenticated: true,
    },
  );
  assert.equal(
    identityFromClerkUser({
      id: "user_admin",
      primaryEmailAddress: { emailAddress: "admin@example.com" },
      publicMetadata: { role: "admin" },
    }).role,
    "admin",
  );
  assert.equal(
    identityFromClerkUser({
      id: "user_untrusted",
      publicMetadata: { role: "owner" },
    }).role,
    "operator",
  );
  assert.throws(
    () => identityFromClerkUser({ id: "user_locked", locked: true }),
    /disabled/,
  );
});

test("Clerk approval pages stay public while inventory APIs require a verified user", async () => {
  const app = (await import("express")).default();
  let resolutions = 0;
  app.use(
    clerkSecurity({
      development: true,
      getUserId: (req) => req.header("x-fixture-user") || undefined,
      resolveUser: async (id) => {
        resolutions++;
        return {
          id,
          fullName: "Approved Operator",
          publicMetadata: { role: "operator" },
        };
      },
    }),
  );
  app.get("/sign-up", (_req, res) => res.send("request access"));
  app.get("/api/whoami", (_req, res) => res.json(res.locals.identity));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const root = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    assert.equal((await fetch(root + "/sign-up")).status, 200);
    assert.equal((await fetch(root + "/api/whoami")).status, 401);
    for (let i = 0; i < 2; i++) {
      const response = await fetch(root + "/api/whoami", {
        headers: { "x-fixture-user": "user_approved" },
      });
      assert.equal(response.status, 200);
      assert.equal(((await response.json()) as Identity).role, "operator");
    }
    assert.equal(resolutions, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("browser sign-in uses secure expiring sessions, rejects cross-site login and revokes on logout", async () => {
  let now = Date.now();
  const db = openDatabase(":memory:");
  const server = createApp(db, {
    users: await users(),
    publicOrigin: "https://inventory.example.com",
    now: () => now,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const root = `http://127.0.0.1:${(server.address() as any).port}`;
  const login = (
    extra: Record<string, string> = {},
    returnTo = "/?bin=IBOLT-123",
  ) =>
    fetch(root + "/login", {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...extra,
      },
      body: new URLSearchParams({
        username: "operator",
        password,
        returnTo,
      }).toString(),
    });
  try {
    const redirect = await fetch(root + "/", { redirect: "manual" });
    assert.equal(redirect.status, 303);
    assert.ok(redirect.headers.get("location")?.startsWith("/login"));
    const page = await fetch(root + "/login");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /autocomplete="current-password"/);
    assert.equal((await login({ Origin: "https://evil.example" })).status, 403);
    const response = await login();
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/?bin=IBOLT-123");
    const setCookie = response.headers.get("set-cookie")!;
    for (const expected of [
      "__Host-iboltscan=",
      "HttpOnly",
      "SameSite=Strict",
      "Secure",
      "Max-Age=28800",
    ])
      assert.ok(setCookie.includes(expected));
    const cookie = setCookie.split(";")[0];
    assert.equal(
      (await fetch(root + "/api/status", { headers: { Cookie: cookie } }))
        .status,
      200,
    );
    assert.equal(
      (
        await fetch(root + "/logout", {
          method: "POST",
          redirect: "manual",
          headers: { Cookie: cookie },
        })
      ).status,
      303,
    );
    assert.equal(
      (await fetch(root + "/api/status", { headers: { Cookie: cookie } }))
        .status,
      401,
    );
    const response2 = await login({}, "//evil.example");
    assert.equal(response2.headers.get("location"), "/");
    now += 8 * 3600000 + 1;
    assert.equal(
      (
        await fetch(root + "/api/status", {
          headers: {
            Cookie: response2.headers.get("set-cookie")!.split(";")[0],
          },
        })
      ).status,
      401,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
