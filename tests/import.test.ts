import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openDatabase } from "../server/db";
import { InventoryStore } from "../server/store";
import { legacyProducts, readLegacyTransfer } from "../scripts/catalog";
import { planCatalog, applyCatalog } from "../scripts/reconcile-catalog";

const sourceHash = "a".repeat(64);
function product(sku = "00123", weight = 2) {
  return legacyProducts(
    [
      {
        id: "source-" + sku,
        title: "Part " + sku,
        sku,
        specs: { unitWeightOz: weight },
      },
    ],
    "fixture.json.txt",
  )[0];
}
function fixture() {
  const db = openDatabase(":memory:");
  const p = product();
  applyCatalog(db, planCatalog([], [p], "b".repeat(64)), "initial", {});
  const store = new InventoryStore(db);
  store.updateProduct(p.id, {
    unitWeightOz: 2,
    barcode: "000987",
    category: "Measured hardware",
    weightNote: "Known sample",
    expectedUpdatedAt: p.updatedAt,
  });
  const bin = store.createBin({
    productId: p.id,
    binLabel: "Fixture",
    unitWeightOz: 2,
    emptyBinWeightOz: 16,
    location: "A",
    notes: "",
  });
  store.calculate({
    binId: bin.id,
    totalWeight: 36,
    weightUnit: "oz",
    roundingMode: "nearest",
    countedBy: "Fixture",
    notes: "",
    save: true,
    requestId: randomUUID(),
    expectedBinUpdatedAt: bin.updatedAt,
  });
  return { db, store, p };
}

test("legacy JSON objects and encoded fields retain leading zeros without using shipping weights", () => {
  const raw = {
    id: "parent",
    title: "Plate",
    variants: [{ id: "00077", sku: "00123", barcode: "000987", grams: 1200 }],
    specs: { unitWeightOz: 0.4 },
  };
  assert.deepEqual(
    legacyProducts([raw], "same").map((p) => ({
      sku: p.sku,
      barcode: p.barcode,
      weight: p.unitWeightOz,
    })),
    [{ sku: "00123", barcode: "000987", weight: 0.4 }],
  );
  assert.equal(
    legacyProducts(
      [{ ...raw, variants: JSON.stringify(raw.variants), specs: "{}" }],
      "same",
    )[0].unitWeightOz,
    null,
  );
  assert.equal(
    legacyProducts(
      [
        { id: "1", sku: "A", title: "A" },
        { id: "2", sku: "A", title: "A", specs: { unitWeightOz: 2 } },
      ],
      "same",
    )[0].unitWeightOz,
    2,
  );
  const conflicted = legacyProducts(
    [
      { id: "1", sku: "A", title: "A", specs: { unitWeightOz: 2 } },
      { id: "2", sku: "A", title: "A", specs: { unitWeightOz: 3 } },
      { id: "3", sku: "A", title: "A", specs: { unitWeightOz: 2 } },
    ],
    "same",
  )[0];
  assert.equal(conflicted.weightStatus, "conflict");
  assert.equal(conflicted.unitWeightOz, null);
});

test("reconciliation preserves measured weights, assigned barcodes, bins and count history", () => {
  const { db, store, p } = fixture();
  try {
    const bins = store.bins(true),
      counts = store.counts();
    const incoming = {
      ...product("00123", 99),
      barcode: "OTHER",
      aliases: ["OTHER"],
      title: "New catalog title",
    };
    const plan = planCatalog(
      store.products(),
      [incoming, product("00456")],
      sourceHash,
    );
    assert.equal(plan.summary.preservedMeasured, 1);
    assert.equal(plan.summary.inserted, 1);
    applyCatalog(db, plan, "new-source", {});
    const after = store.product(p.id);
    assert.equal(after.unitWeightOz, 2);
    assert.equal(after.weightStatus, "verified");
    assert.equal(after.weightNote, "Known sample");
    assert.equal(after.barcode, "000987");
    assert.equal(after.aliases.includes("OTHER"), false);
    assert.equal(after.title, "New catalog title");
    assert.equal(after.category, "Measured hardware");
    assert.deepEqual(store.bins(true), bins);
    assert.deepEqual(store.counts(), counts);
    assert.equal(
      applyCatalog(db, plan, "new-source", {}).alreadyImported,
      true,
    );
    assert.equal(store.products().length, 2);
  } finally {
    db.close();
  }
});

test("stale previews and new barcode collisions reject the entire import", () => {
  const { db, store, p } = fixture();
  try {
    const plan = planCatalog(store.products(), [product("00456")], sourceHash);
    const current = store.product(p.id);
    store.updateProduct(p.id, {
      ...current,
      unitWeightOz: 3,
      expectedUpdatedAt: current.updatedAt,
    });
    assert.throws(
      () => applyCatalog(db, plan, "stale", {}),
      /changed after preview/,
    );
    assert.equal(store.products().length, 1);
    const collision = planCatalog(
      store.products(),
      [{ ...product("00456"), barcode: "000987" }],
      sourceHash,
    );
    assert.equal(collision.summary.barcodeConflicts.length, 1);
    assert.throws(
      () => applyCatalog(db, collision, "collision", {}),
      /collisions/,
    );
    assert.equal(store.products().length, 1);
  } finally {
    db.close();
  }
});

test("conflicting imported weights are flagged; missing source weights never erase existing weights", () => {
  const current = product("00123", 2);
  const conflict = planCatalog([current], [product("00123", 3)], sourceHash);
  assert.equal(conflict.rows[0].after.weightStatus, "conflict");
  assert.equal(conflict.rows[0].after.unitWeightOz, null);
  const missing = {
    ...product("00123"),
    unitWeightOz: null,
    weightStatus: "missing" as const,
  };
  assert.equal(
    planCatalog([current], [missing], sourceHash).rows[0].after.unitWeightOz,
    2,
  );
  const later = { ...product("00123"), updatedAt: "2099-01-01T00:00:00.000Z" };
  assert.equal(
    planCatalog([], [current], sourceHash).planHash,
    planCatalog([], [later], sourceHash).planHash,
  );
});

test("transfer validation checks company scope and retains pending bin/count totals", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "iboltscan-transfer-test-"),
  );
  const filename = path.join(directory, "inventory-transfer.json.txt");
  const value = {
    formatVersion: 1,
    exportedAt: "2026-09-03T00:00:00.000Z",
    sourceSnapshot: "fixture.sqlite",
    companyId: "ibolt-default-company",
    products: [
      {
        id: "p1",
        title: "Part",
        sku: "00123",
        company_id: "ibolt-default-company",
      },
    ],
    bins: [{ id: "b1", company_id: "ibolt-default-company" }],
    counts: [],
  };
  try {
    await writeFile(filename, JSON.stringify(value));
    const parsed = await readLegacyTransfer(filename);
    assert.equal(parsed.products[0].sku, "00123");
    assert.equal(parsed.summary.sourceBins, 1);
    value.products[0].company_id = "different-company";
    await writeFile(filename, JSON.stringify(value));
    await assert.rejects(readLegacyTransfer(filename), /different company's/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI preview does not create a database; applying a reviewed preview backs up before changing records", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "iboltscan-import-cli-test-"),
  );
  const source = path.join(directory, "inventory-transfer.json.txt"),
    destination = path.join(directory, "inventory.sqlite");
  const data = {
    formatVersion: 1,
    exportedAt: "2026-09-03T00:00:00.000Z",
    sourceSnapshot: "fixture",
    companyId: "ibolt-default-company",
    products: [{ id: "p1", title: "Fixture", sku: "00123" }],
    bins: [],
    counts: [],
  };
  const call = (extra: string[] = []) =>
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/import-catalog.ts",
        source,
        "--database",
        destination,
        ...extra,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, BACKUP_DIR: path.join(directory, "backups") },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  const token = (output: string) =>
    output.match(/"planHash": "([a-f0-9]{64})"/)![1];
  try {
    await writeFile(source, JSON.stringify(data));
    const first = call();
    assert.equal(existsSync(destination), false);
    assert.throws(() => call(["--apply"]), /expect-plan/);
    call(["--apply", "--expect-plan", token(first)]);
    const db = openDatabase(destination);
    assert.equal(new InventoryStore(db).products().length, 1);
    db.close();
    data.products.push({ id: "p2", title: "Second fixture", sku: "00456" });
    await writeFile(source, JSON.stringify(data));
    const second = call();
    const before = await readFile(destination);
    call(["--apply", "--expect-plan", token(second)]);
    const backupFiles = (await readdir(path.join(directory, "backups"))).filter(
      (p) => p.endsWith(".sqlite"),
    );
    assert.equal(backupFiles.length, 1);
    const backup = openDatabase(
      path.join(directory, "backups", backupFiles[0]),
    );
    assert.equal(new InventoryStore(backup).products().length, 1);
    backup.close();
    const updated = openDatabase(destination);
    assert.equal(new InventoryStore(updated).products().length, 2);
    updated.close();
    assert.notDeepEqual(await readFile(destination), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
