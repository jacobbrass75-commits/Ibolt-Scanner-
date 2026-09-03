import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { request } from "node:http";
import { openDatabase } from "../server/db";
import { InventoryStore } from "../server/store";
import { calculate, normalizeScan } from "../server/domain";
import { createApp, csvCell } from "../server/app";
import { parseWeight } from "../scripts/catalog";

function fixture() {
  const db = openDatabase(":memory:"),
    store = new InventoryStore(db);
  db.prepare(
    "INSERT INTO products(id,sku,title,barcode,aliases,unitWeightOz,weightStatus,updatedAt) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    "test-part",
    "00123",
    "Test part",
    "009876543210",
    '["00123"]',
    2,
    "verified",
    new Date().toISOString(),
  );
  const bin = store.createBin({
    productId: "test-part",
    binLabel: "Test bin",
    unitWeightOz: 2,
    emptyBinWeightOz: 16,
    location: "Test shelf",
    notes: "",
  });
  return { db, store, bin };
}
test("correct tare subtraction and unit conversions, including empty bins", () => {
  for (const [amount, unit] of [
    [36, "oz"],
    [2.25, "lb"],
    [36 * 28.349523125, "g"],
    [(36 * 28.349523125) / 1000, "kg"],
  ] as const)
    assert.equal(calculate(amount, unit, 16, 2, "nearest").quantity, 10);
  assert.equal(calculate(16, "oz", 16, 2, "nearest").quantity, 0);
  assert.equal(calculate(0, "oz", 0, 2, "nearest").quantity, 0);
  assert.equal(calculate(0.3, "oz", 0, 0.1, "floor").quantity, 3);
  assert.equal(calculate(0.3, "oz", 0, 0.1, "ceil").quantity, 3);
  assert.throws(() => calculate(15, "oz", 16, 2, "nearest"), /below/);
  assert.throws(() => calculate(20, "oz", 16, 0, "nearest"), /valid weights/);
  assert.equal(calculate(37, "oz", 16, 2, "floor").quantity, 10);
  assert.equal(calculate(37, "oz", 16, 2, "ceil").quantity, 11);
});
test("portable, old URL, JSON and keyboard scanner payloads preserve leading zeros", () => {
  assert.equal(normalizeScan(" ]C100123\r\n"), "00123");
  assert.equal(normalizeScan("IBOLTINV:IBOLT-123"), "IBOLT-123");
  assert.equal(
    normalizeScan("https://old.example/blog/inventory?bin=IBOLT-123"),
    "IBOLT-123",
  );
  assert.equal(normalizeScan('IBOLTINV:{"qrCode":"00123"}'), "00123");
  assert.equal(normalizeScan("009876543210"), "009876543210");
});
test("exact product matching and multiple bin selection; no partial barcode matches", () => {
  const { db, store, bin } = fixture();
  try {
    assert.equal(store.lookup("009876543210").products[0].sku, "00123");
    assert.equal(store.lookup("987654").products.length, 0);
    assert.equal(store.lookup(bin.qrCode).bins[0].id, bin.id);
    store.createBin({
      productId: "test-part",
      binLabel: "Second bin",
      unitWeightOz: 2,
      emptyBinWeightOz: 8,
      location: "B",
      notes: "",
    });
    assert.equal(store.lookup("00123").bins.length, 2);
    store.archiveBin(bin.id);
    assert.equal(store.lookup("00123").bins.length, 1);
    assert.equal(store.lookup(bin.qrCode).bins.length, 0);
  } finally {
    db.close();
  }
});
test("preview does not persist; save is atomic and idempotent with an immutable calibration snapshot", () => {
  const { db, store, bin } = fixture();
  try {
    const base = {
      binId: bin.id,
      totalWeight: 36,
      weightUnit: "oz" as const,
      roundingMode: "nearest" as const,
      countedBy: "Tester",
      notes: "Known 10 pieces",
      save: false,
    };
    const preview = store.calculate(base);
    assert.equal(preview.quantity, 10);
    assert.equal(store.counts().length, 0);
    const save = {
      ...base,
      save: true,
      requestId: randomUUID(),
      expectedBinUpdatedAt: preview.bin.updatedAt,
    };
    const first = store.calculate(save),
      repeat = store.calculate(save);
    assert.equal(first.count?.id, repeat.count?.id);
    assert.equal(store.counts().length, 1);
    assert.equal(store.bin(bin.id).lastQuantity, 10);
    assert.throws(
      () => store.calculate({ ...save, totalWeight: 38 }),
      /different inputs/,
    );
    const fresh = store.bin(bin.id);
    store.updateBin(bin.id, {
      ...fresh,
      unitWeightOz: 4,
      expectedUpdatedAt: fresh.updatedAt,
    });
    assert.equal(store.counts()[0].unitWeightOz, 2);
    assert.equal(store.calculate(save).count?.id, first.count?.id);
    assert.throws(
      () => store.calculate({ ...save, requestId: randomUUID() }),
      /changed/,
    );
    store.archiveBin(bin.id);
    assert.equal(store.counts().length, 1);
    assert.throws(() => store.calculate({ ...base, save: false }), /archived/);
  } finally {
    db.close();
  }
});
test("measurement history is audited and barcode collision is rejected", () => {
  const { db, store } = fixture();
  try {
    const p = store.product("test-part");
    store.updateProduct(p.id, {
      unitWeightOz: 3,
      barcode: "00077",
      category: "Parts",
      weightNote: "Sample of ten",
      expectedUpdatedAt: p.updatedAt,
    });
    assert.equal(store.product(p.id).weightStatus, "verified");
    assert.equal(store.lookup("00077").products[0].id, p.id);
    assert.ok(
      db.prepare("SELECT * FROM audit WHERE kind='product_measurement'").get(),
    );
    db.prepare(
      "INSERT INTO products(id,sku,title,updatedAt) VALUES(?,?,?,?)",
    ).run("other", "00999", "Other", "2020");
    assert.throws(
      () =>
        store.updateProduct("other", {
          unitWeightOz: 2,
          barcode: "00077",
          category: "Parts",
          weightNote: "",
          expectedUpdatedAt: "2020",
        }),
      /another catalog/,
    );
  } finally {
    db.close();
  }
});
test("workbook weight parser rejects ambiguous or invalid weights rather than guessing", () => {
  assert.equal(parseWeight("1 lb 4 oz"), 20);
  assert.equal(parseWeight("2.5 oz"), 2.5);
  for (const input of [
    "1 lb 4 lbs",
    "-2 oz",
    "0",
    "0 oz",
    "approx 5",
    "",
    null,
  ])
    assert.equal(parseWeight(input), null);
});
test("CSV neutralizes formula injection and quotes embedded commas", () => {
  assert.equal(csvCell("=SUM(1,2)"), '"\'=SUM(1,2)"');
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
});
test("API enforces host/origin, validates input, and supports lookup-preview-save round trip", async () => {
  const { db, bin } = fixture();
  const server = createApp(db).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const root = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal(
      (
        await fetch(root + "/api/products", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const badHostStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        const req = request(
          root + "/api/products",
          { headers: { Host: "evil.example" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    assert.equal(badHostStatus, 403);
    assert.equal((await fetch(root + "/api/lookup?code=00123")).status, 200);
    const post = (body: unknown) =>
      fetch(root + "/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal((await post({ binId: bin.id, totalWeight: -1 })).status, 400);
    const body = {
      binId: bin.id,
      totalWeight: 36,
      weightUnit: "oz",
      roundingMode: "nearest",
      save: false,
    };
    const preview = (await (await post(body)).json()) as any;
    assert.equal(preview.quantity, 10);
    const save = await post({
      ...body,
      save: true,
      expectedBinUpdatedAt: preview.bin.updatedAt,
      requestId: randomUUID(),
    });
    assert.equal(save.status, 200);
    assert.equal(((await save.json()) as any).count.quantity, 10);
    assert.equal((await fetch(root + "/api/export/counts")).status, 200);
    assert.equal((await fetch(root + "/api/blog/products")).status, 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
test("configured deployment requires authentication for reads and writes", async () => {
  const db = openDatabase(":memory:");
  const server = createApp(db, { password: "test-only-password" }).listen(
    0,
    "127.0.0.1",
  );
  await once(server, "listening");
  const root = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    assert.equal((await fetch(root + "/api/products")).status, 401);
    assert.equal(
      (
        await fetch(root + "/api/products", {
          headers: {
            Authorization:
              "Basic " +
              Buffer.from("operator:test-only-password").toString("base64"),
          },
        })
      ).status,
      200,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
