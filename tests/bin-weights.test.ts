import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { openDatabase } from "../server/db";
import { InventoryStore } from "../server/store";
import { createApp } from "../server/app";
import { hashPassword } from "../server/security";
import {
  partOunces,
  readBinWeightWorkbook,
  type WeightSheetRow,
} from "../scripts/bin-weight-workbook";
import { planBinWeights, applyBinWeights } from "../scripts/bin-weight-import";
import { binWeights, setUpImportedBin } from "../server/bin-weights";

async function workbook(body: string) {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    '<workbook><sheets><sheet name="Weights" r:id="rId1"/></sheets></workbook>',
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Part</t></is></c><c r="B1" t="inlineStr"><is><t>Part (oz)</t></is></c><c r="C1" t="inlineStr"><is><t>Bin 1 (Lbs)</t></is></c><c r="D1" t="inlineStr"><is><t>Bin 2 (Lbs)</t></is></c></row>${body}</sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}
const row = (
  sku: string,
  index: number,
  weight: number | null = 3,
): WeightSheetRow => ({
  sheet: "Weights",
  row: index,
  sku,
  partWeightOz: weight,
  rawPartWeight: weight === null ? "" : String(weight),
  bins: [{ cell: `C${index}`, number: 1, raw: "7.5", weightLb: 7.5 }],
});
function fixture() {
  const db = openDatabase(":memory:"),
    store = new InventoryStore(db, "fixture");
  const add = (
    id: string,
    sku: string,
    weight: number | null,
    status: string,
    aliases: string[] = [],
  ) =>
    db
      .prepare(
        "INSERT INTO products(id,sku,title,aliases,unitWeightOz,weightStatus,updatedAt) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        id,
        sku,
        "Fixture " + id,
        JSON.stringify(aliases),
        weight,
        status,
        "2026-01-01T00:00:00.000Z",
      );
  add("measured", "00123", 2, "verified");
  add("missing", "00456", null, "missing");
  add("old", "OLD", 0.08, "imported");
  add("shared-a", "SHARED", null, "missing");
  add("shared-b", "SHARED", null, "missing");
  add("alias", "OTHER", null, "missing", ["00123-ALT"]);
  return { db, store, add };
}
test("bin sheet preserves blank versus zero, repeated SKU rows, original cells and mixed pound/ounce parts", async () => {
  for (const [raw, expected] of [
    ["3LBS 12.3 OZ", 60.3],
    ["1LB. 8.4OZ", 24.4],
    ["2LBS 12OZ", 44],
    ["10.2 OZ", 10.2],
    ["1LBS 0.6OZ", 16.6],
    ["0.8", 0.8],
    ["", null],
  ] as const)
    assert.equal(partOunces(raw), expected);
  for (const raw of ["0", "-1", "1 kg", "=2+2", "NaN", "2 oz per box"])
    assert.throws(() => partOunces(raw));
  const rows = await readBinWeightWorkbook(
    await workbook(
      '<row r="2"><c r="A2" t="inlineStr"><is><t>00123</t></is></c><c r="B2" t="inlineStr"><is><t>1LB. 8.4OZ</t></is></c><c r="C2"><v>0</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>00123</t></is></c><c r="D3"><v>7.5</v></c></row>',
    ),
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sku, "00123");
  assert.equal(rows[0].partWeightOz, 24.4);
  assert.deepEqual(rows[0].bins, [
    { cell: "C2", number: 1, raw: "0", weightLb: 0 },
  ]);
  assert.equal(rows[1].partWeightOz, null);
  assert.equal(rows[1].bins[0].number, 2);
  await assert.rejects(
    readBinWeightWorkbook(
      await workbook(
        '<row r="2"><c r="A2"><v>123</v></c><c r="C2"><f>1+2</f><v>3</v></c></row>',
      ),
    ),
    /formulas/,
  );
});
test("import preserves measured calibration and history, retains unresolved rows, and is atomic and repeatable", () => {
  const { db, store } = fixture();
  try {
    const bin = store.createBin({
      productId: "measured",
      binLabel: "Existing",
      unitWeightOz: 2,
      emptyBinWeightOz: 16,
      location: "Shelf",
      notes: "",
    });
    store.calculate({
      binId: bin.id,
      totalWeight: 36,
      weightUnit: "oz",
      roundingMode: "nearest",
      save: true,
      requestId: randomUUID(),
      expectedBinUpdatedAt: bin.updatedAt,
      countedBy: "Fixture",
      notes: "",
    });
    const beforeBins = store.bins(true),
      beforeCounts = store.counts();
    const source = [
      row("00123", 2, 8),
      row("00456", 3, 3),
      row("00456", 4, null),
      row("SHARED", 5, 4),
      row("UNKNOWN", 6, 5),
      row("OLD", 7, 0.8),
    ];
    const plan = planBinWeights(
      store.products(),
      source,
      "a".repeat(64),
      "fixture.xlsx",
      "Fixture provenance",
    );
    assert.equal(plan.measurements.length, 6);
    assert.equal(plan.summary.preservedVerified.length, 1);
    assert.equal(plan.summary.ambiguous.length, 1);
    assert.equal(plan.summary.unmatched.length, 1);
    assert.equal(plan.summary.weightUpdates.length, 2);
    applyBinWeights(db, plan);
    assert.equal(store.product("measured").unitWeightOz, 2);
    assert.equal(store.product("measured").weightStatus, "verified");
    assert.equal(store.product("missing").unitWeightOz, 3);
    assert.equal(store.product("old").unitWeightOz, 0.8);
    assert.equal(store.product("shared-a").unitWeightOz, null);
    assert.deepEqual(store.bins(true), beforeBins);
    assert.deepEqual(store.counts(), beforeCounts);
    assert.equal(binWeights(store).filter((r) => !r.productId).length, 2);
    assert.equal(binWeights(store).filter((r) => r.sku === "00456").length, 2);
    assert.equal(
      (store.product("missing").source.binWeightSources as any[])[0].cell,
      "B3",
    );
    const audit = db.prepare("SELECT count(*) AS n FROM audit").get();
    assert.equal(applyBinWeights(db, plan).alreadyImported, true);
    assert.deepEqual(
      db.prepare("SELECT count(*) AS n FROM audit").get(),
      audit,
    );
    const stale = planBinWeights(
      store.products(),
      [row("00456", 2, 10)],
      "b".repeat(64),
      "later.xlsx",
      "",
    );
    db.prepare(
      "UPDATE products SET unitWeightOz=7, weightStatus='verified' WHERE id='missing'",
    ).run();
    assert.throws(() => applyBinWeights(db, stale), /changed after preview/);
    assert.equal(
      db
        .prepare("SELECT id FROM imports WHERE sourceHash=?")
        .get(stale.sourceHash),
      undefined,
    );
    assert.equal(binWeights(store).length, 6);
  } finally {
    db.close();
  }
});
test("conflicting duplicate part weights and cross-SKU aliases never silently choose a calibration", () => {
  const { db, store, add } = fixture();
  try {
    add("collision", "00456-ALT", null, "missing", ["00456"]);
    const plan = planBinWeights(
      store.products(),
      [row("OLD", 2, 2), row("OLD", 3, 4), row("00456", 4, 3)],
      "c".repeat(64),
      "fixture.xlsx",
      "",
    );
    assert.deepEqual(plan.summary.conflictingPartWeights, ["OLD"]);
    assert.equal(plan.summary.ambiguous.length, 1);
    applyBinWeights(db, plan);
    assert.equal(store.product("old").unitWeightOz, 0.08);
    assert.equal(store.product("missing").unitWeightOz, null);
    assert.equal(binWeights(store).length, 3);
  } finally {
    db.close();
  }
});
test("confirmed setup creates one bin with provenance, never a historical or synthetic count", () => {
  const { db, store } = fixture();
  try {
    applyBinWeights(
      db,
      planBinWeights(
        store.products(),
        [row("00456", 2)],
        "d".repeat(64),
        "fixture.xlsx",
        "",
      ),
    );
    const weight = binWeights(store)[0];
    const input = {
      productId: "missing",
      binLabel: "Measured bin",
      unitWeightOz: 3,
      emptyBinWeightOz: 8,
      location: "Office",
      notes: "Checked",
      expectedUpdatedAt: weight.updatedAt,
    };
    assert.throws(
      () =>
        setUpImportedBin(store, weight.id, {
          ...input,
          expectedUpdatedAt: "stale",
        }),
      /changed/,
    );
    assert.throws(
      () =>
        setUpImportedBin(store, weight.id, { ...input, productId: "absent" }),
      /not found/,
    );
    assert.equal(store.bins().length, 0);
    const bin = setUpImportedBin(store, weight.id, input);
    assert.match(bin.notes, /Weights!C2/);
    assert.equal(bin.emptyBinWeightOz, 8);
    assert.equal(binWeights(store)[0].binId, bin.id);
    assert.equal(store.counts().length, 0);
    assert.throws(
      () => setUpImportedBin(store, weight.id, input),
      /already has a bin/,
    );
    assert.equal(store.bins().length, 1);
    assert.equal(store.counts().length, 0);
  } finally {
    db.close();
  }
});
test("bin-weight APIs require authentication, an editing role and explicit measured calibration", async () => {
  const { db, store } = fixture();
  applyBinWeights(
    db,
    planBinWeights(
      store.products(),
      [row("00456", 2)],
      "e".repeat(64),
      "fixture.xlsx",
      "",
    ),
  );
  const password = "isolated-fixture-password",
    passwordHash = await hashPassword(password);
  const server = createApp(db, {
    users: ["admin", "viewer"].map((role) => ({
      username: role,
      displayName: role,
      role: role as "admin" | "viewer",
      passwordHash,
    })),
    publicOrigin: "https://inventory.example.com",
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = (path: string, role?: string, body?: unknown) =>
    fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        Host: "inventory.example.com",
        "X-Forwarded-Proto": "https",
        ...(role
          ? {
              Authorization:
                "Basic " +
                Buffer.from(`${role}:${password}`).toString("base64"),
            }
          : {}),
        ...(body
          ? {
              "Content-Type": "application/json",
              Origin: "https://inventory.example.com",
            }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    assert.equal((await call("/api/bin-weights")).status, 401);
    const read = await call("/api/bin-weights", "viewer");
    assert.equal(read.status, 200);
    const measurement = ((await read.json()) as any[])[0];
    const path = `/api/bin-weights/${measurement.id}/bin`;
    const body = {
      productId: "missing",
      binLabel: "Fixture bin",
      unitWeightOz: 3,
      expectedUpdatedAt: measurement.updatedAt,
      weightsConfirmed: true,
    };
    assert.equal(
      (await call(path, "viewer", { ...body, emptyBinWeightOz: 8 })).status,
      403,
    );
    assert.equal((await call(path, "admin", body)).status, 400);
    assert.equal(
      (
        await call(path, "admin", {
          ...body,
          emptyBinWeightOz: 8,
          weightsConfirmed: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (await call(path, "admin", { ...body, emptyBinWeightOz: 8 })).status,
      201,
    );
    assert.equal(
      (await call(path, "admin", { ...body, emptyBinWeightOz: 8 })).status,
      409,
    );
    assert.equal(store.counts().length, 0);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
