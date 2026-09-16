import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { openDatabase, SCHEMA_VERSION } from "../server/db";
import { InventoryStore } from "../server/store";
import { createApp } from "../server/app";
import { hashPassword } from "../server/security";
import type { AuthUser } from "../server/config";
import type { Product } from "../shared/types";

function entry(
  overrides: Partial<Parameters<InventoryStore["createProduct"]>[0]> = {},
) {
  return {
    requestId: randomUUID(),
    sku: "00042",
    title: "New part",
    barcode: "00000042",
    category: "Warehouse",
    itemType: "part" as const,
    weightNote: "",
    ...overrides,
  };
}

test("manual parts and complete kits keep independent identities, measured weights and audited provenance", () => {
  const db = openDatabase(":memory:");
  const store = new InventoryStore(db, "warehouse-operator");
  try {
    const part = store.createProduct(entry());
    assert.equal(part.sku, "00042");
    assert.equal(part.barcode, "00000042");
    assert.equal(part.unitWeightOz, null);
    assert.equal(part.weightStatus, "missing");
    assert.equal(part.source.kind, "manual");
    assert.equal(part.source.itemType, "part");
    assert.equal(part.source.createdBy, "warehouse-operator");
    assert.deepEqual(
      store.lookup("00000042").products.map((p) => p.id),
      [part.id],
    );
    const kit = store.createProduct(
      entry({
        sku: "KIT-042",
        barcode: "000042-KIT",
        title: "Complete mount kit",
        itemType: "kit",
        unitWeightOz: 8,
        weightNote: "Ten complete kits weighed 80 oz, without the container.",
      }),
    );
    assert.equal(kit.unitWeightOz, 8);
    assert.equal(kit.weightStatus, "verified");
    assert.equal(kit.source.itemType, "kit");
    assert.notEqual(kit.id, part.id);
    assert.equal(store.bins(true).length, 0);
    assert.equal(store.countTotal(), 0);
    assert.equal(db.pragma("user_version", { simple: true }), SCHEMA_VERSION);
    const audit = db
      .prepare("SELECT * FROM audit WHERE kind='product_created'")
      .all() as any[];
    assert.equal(audit.length, 2);
    assert.ok(audit.every((row) => row.actorId === "warehouse-operator"));
    assert.deepEqual(JSON.parse(audit[1].afterValue), kit);
    assert.equal(JSON.parse(audit[1].beforeValue), null);
  } finally {
    db.close();
  }
});

test("new scan codes reject collisions while preserving legacy duplicate variants, measurements and stock", () => {
  const db = openDatabase(":memory:");
  const store = new InventoryStore(db, "operator");
  const now = "2026-01-01T00:00:00.000Z";
  db.prepare(
    "INSERT INTO products(id,sku,title,barcode,aliases,unitWeightOz,weightStatus,source,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    "variant-a",
    "SHARED",
    "Variant A",
    "000999",
    '["ALTERNATE"]',
    2,
    "verified",
    '{"kind":"shopify","variantId":"variant-a"}',
    now,
  );
  db.prepare(
    "INSERT INTO products(id,sku,title,barcode,aliases,unitWeightOz,weightStatus,source,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    "variant-b",
    "SHARED",
    "Variant B",
    "",
    "[]",
    3,
    "imported",
    '{"kind":"shopify","variantId":"variant-b"}',
    now,
  );
  const bin = store.createBin({
    productId: "variant-a",
    binLabel: "Existing",
    unitWeightOz: 2,
    emptyBinWeightOz: 4,
    location: "A1",
    notes: "Keep",
  });
  store.calculate({
    binId: bin.id,
    totalWeight: 24,
    weightUnit: "oz",
    roundingMode: "nearest",
    save: true,
    requestId: randomUUID(),
    expectedBinUpdatedAt: bin.updatedAt,
    countedBy: "Operator",
    notes: "Existing real fixture count",
  });
  store.archiveBin(bin.id);
  const before = {
    products: store.products(),
    bins: store.bins(true),
    counts: store.counts(),
    audit: db.prepare("SELECT * FROM audit").all(),
  };
  try {
    for (const code of [
      "shared",
      "000999",
      "alternate",
      bin.qrCode.toLowerCase(),
      bin.id,
    ]) {
      assert.throws(
        () => store.createProduct(entry({ sku: code, barcode: "" })),
        /already exists|belongs to/,
      );
      assert.throws(
        () => store.createProduct(entry({ sku: "FRESH", barcode: code })),
        /belongs to/,
      );
    }
    for (const code of [
      "IBOLTINV:NEW",
      "]C100042",
      "https://example.test/?sku=NEW",
      "A\u0002B",
    ]) {
      assert.throws(
        () => store.createProduct(entry({ sku: code, barcode: "" })),
        /literal/,
      );
    }
    assert.deepEqual(
      {
        products: store.products(),
        bins: store.bins(true),
        counts: store.counts(),
        audit: db.prepare("SELECT * FROM audit").all(),
      },
      before,
    );
    const fresh = store.createProduct(
      entry({ sku: "000NEW", barcode: "000NEW" }),
    );
    assert.deepEqual(
      store.lookup("000NEW").products.map((p) => p.id),
      [fresh.id],
    );
    assert.deepEqual(
      store.products().filter((p) => p.id !== fresh.id),
      before.products,
    );
    assert.deepEqual(store.bins(true), before.bins);
    assert.deepEqual(store.counts(), before.counts);
  } finally {
    db.close();
  }
});

test("creation retries are bound to actor and original input and cannot undo later measurement changes", () => {
  const db = openDatabase(":memory:");
  const store = new InventoryStore(db, "operator");
  try {
    const input = entry();
    const product = store.createProduct(input);
    assert.deepEqual(
      store.createProduct({
        ...input,
        sku: ` ${input.sku} `,
        unitWeightOz: null,
      }),
      product,
    );
    for (const change of [
      { title: "Different" },
      { itemType: "kit" as const },
      { barcode: "999" },
      { unitWeightOz: 1, weightNote: "Measured" },
    ])
      assert.throws(
        () => store.createProduct({ ...input, ...change }),
        /different inputs/,
      );
    assert.throws(
      () => new InventoryStore(db, "other-operator").createProduct(input),
      /another operator/,
    );
    assert.equal(store.products().length, 1);
    assert.equal(
      (
        db
          .prepare(
            "SELECT count(*) AS n FROM audit WHERE kind='product_created'",
          )
          .get() as any
      ).n,
      1,
    );
    const measured = store.updateProduct(product.id, {
      unitWeightOz: 3,
      barcode: "000NEWBAR",
      category: "Measured",
      weightNote: "Measured sample of 10",
      expectedUpdatedAt: product.updatedAt,
    });
    assert.deepEqual(store.createProduct(input), measured);
    assert.equal(
      (
        db
          .prepare(
            "SELECT count(*) AS n FROM audit WHERE kind='product_created'",
          )
          .get() as any
      ).n,
      1,
    );
    assert.equal(store.bins(true).length, 0);
    assert.equal(store.countTotal(), 0);
  } finally {
    db.close();
  }
});

test("product creation rolls back when its audit cannot be saved", () => {
  const db = openDatabase(":memory:");
  const store = new InventoryStore(db, "operator");
  try {
    db.exec(
      "CREATE TRIGGER reject_product_audit BEFORE INSERT ON audit WHEN NEW.kind='product_created' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
    );
    assert.throws(() => store.createProduct(entry()), /test audit failure/);
    assert.equal(store.products().length, 0);
    assert.equal(
      (db.prepare("SELECT count(*) AS n FROM audit").get() as any).n,
      0,
    );
  } finally {
    db.close();
  }
});

test("manual creation API enforces roles and validation and complete kit counts use one kit weight", async () => {
  const db = openDatabase(":memory:");
  const store = new InventoryStore(db);
  const password = "fixture-only-manual-products-password";
  const passwordHash = await hashPassword(password);
  const users: AuthUser[] = (["admin", "operator", "viewer"] as const).map(
    (role) => ({
      username: role,
      displayName: `${role} name`,
      role,
      passwordHash,
    }),
  );
  const server = createApp(db, {
    users,
    publicOrigin: "https://inventory.example.com",
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const root = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (url: string, body?: unknown, role = "operator") =>
    fetch(root + url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${role}:${password}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    assert.equal(
      (
        await fetch(root + "/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry()),
        })
      ).status,
      401,
    );
    assert.equal((await call("/api/products", entry(), "viewer")).status, 403);
    for (const change of [
      { sku: " " },
      { title: "" },
      { itemType: "component" },
      { unitWeightOz: 0 },
      { unitWeightOz: -1 },
      { unitWeightOz: "3" },
      { unitWeightOz: 1e10 },
      { unitWeightOz: 2, weightNote: " " },
      { requestId: "invalid" },
      { actorId: "admin" },
      { components: [] },
      { sku: "S".repeat(201) },
    ]) {
      const response = await call("/api/products", { ...entry(), ...change });
      assert.equal(response.status, 400, JSON.stringify(change));
    }
    assert.equal(store.products().length, 0);
    const adminProduct = await call(
      "/api/products",
      entry({ sku: "PART-A", barcode: "" }),
      "admin",
    );
    assert.equal(adminProduct.status, 201);
    assert.equal(
      ((await adminProduct.json()) as Product).source.createdBy,
      "admin",
    );
    const input = entry({
      sku: "KIT-A",
      barcode: "0000099",
      itemType: "kit",
      unitWeightOz: 8,
      weightNote: "Complete assembled kit measured at 8 oz.",
    });
    const response = await call("/api/products", input);
    assert.equal(response.status, 201);
    const kit = (await response.json()) as Product;
    assert.equal(kit.source.createdBy, "operator");
    assert.equal(kit.source.itemType, "kit");
    assert.deepEqual(await (await call("/api/products", input)).json(), kit);
    assert.equal(
      (await call("/api/products", { ...input, title: "Changed" })).status,
      409,
    );
    assert.equal(
      (await call("/api/products", { ...input, requestId: randomUUID() }))
        .status,
      409,
    );
    const lookup = (await (
      await call("/api/lookup?code=0000099")
    ).json()) as any;
    assert.deepEqual(
      lookup.products.map((p: Product) => p.id),
      [kit.id],
    );
    assert.equal(store.bins(true).length, 0);
    assert.equal(store.countTotal(), 0);
    const binResponse = await call("/api/bins", {
      productId: kit.id,
      binLabel: "Three assembled kits",
      unitWeightOz: kit.unitWeightOz,
      emptyBinWeightOz: 4,
      location: "QA only",
      notes: "Isolated test",
      weightsConfirmed: true,
    });
    assert.equal(binResponse.status, 201);
    const bin = (await binResponse.json()) as any;
    const countInput = {
      binId: bin.id,
      totalWeight: 28,
      weightUnit: "oz",
      roundingMode: "nearest",
      countedBy: "spoofed",
      notes: "Test fixture",
      save: false,
    };
    const preview = (await (
      await call("/api/calculate", countInput)
    ).json()) as any;
    assert.equal(preview.quantity, 3);
    assert.equal(store.countTotal(), 0);
    const countResponse = await call("/api/calculate", {
      ...countInput,
      save: true,
      requestId: randomUUID(),
      expectedBinUpdatedAt: preview.bin.updatedAt,
    });
    assert.equal(countResponse.status, 200);
    const saved = (await countResponse.json()) as any;
    assert.equal(saved.count.quantity, 3);
    assert.equal(saved.count.countedBy, "operator name");
    assert.equal(saved.count.actorId, "operator");
    assert.equal(store.countTotal(), 1);
    assert.equal(store.products().length, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    db.close();
  }
});
