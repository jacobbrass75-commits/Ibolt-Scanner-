import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readWeightWorkbook, readLegacyCatalog } from "./catalog";
import { openDatabase } from "../server/db";
import { InventoryStore } from "../server/store";

const filename = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!filename)
  throw new Error(
    'Usage: npm run import:catalog -- "path/to/file.xlsx or .sqlite" [--apply]',
  );
const result = /\.xlsx$/i.test(filename)
  ? await readWeightWorkbook(filename)
  : readLegacyCatalog(filename);
console.log(JSON.stringify(result.summary, null, 2));
if (!process.argv.includes("--apply")) {
  console.log(
    "Preview only. Add --apply to import into the inventory database.",
  );
  process.exit(0);
}
const db = openDatabase();
const store = new InventoryStore(db);
const hash = createHash("sha256")
  .update(await readFile(filename))
  .digest("hex");
if (db.prepare("SELECT id FROM imports WHERE sourceHash=?").get(hash)) {
  db.close();
  console.log("This source file is already imported. No changes made.");
  process.exit(0);
}
let inserted = 0,
  merged = 0;
db.transaction(() => {
  for (const p of result.products) {
    const existing = store
      .products()
      .find((e) => e.sku.toLowerCase() === p.sku.toLowerCase());
    let row = p;
    if (existing) {
      const workbook = /\.xlsx$/i.test(filename);
      row = {
        ...existing,
        aliases: [...new Set([...existing.aliases, ...p.aliases])],
        source: { ...existing.source, ...p.source },
        updatedAt: new Date().toISOString(),
      };
      if (
        existing.weightStatus !== "verified" &&
        (workbook || existing.weightStatus === "missing")
      )
        row = {
          ...row,
          unitWeightOz: p.unitWeightOz,
          weightStatus: p.weightStatus,
          weightNote: p.weightNote,
        };
      if (!row.barcode) row.barcode = p.barcode;
      if (workbook) {
        row.title = p.title;
        row.category = p.category;
      }
      merged++;
    } else inserted++;
    const value = {
      ...row,
      aliases: JSON.stringify(row.aliases),
      source: JSON.stringify(row.source),
    };
    const keys = Object.keys(value);
    db.prepare(
      `INSERT INTO products(${keys.join(",")}) VALUES(${keys.map((k) => "@" + k).join(",")}) ON CONFLICT(id) DO UPDATE SET ${keys
        .filter((k) => k !== "id")
        .map((k) => `${k}=excluded.${k}`)
        .join(",")}`,
    ).run(value);
    store.audit("catalog_import", row.id, existing || null, row);
  }
  db.prepare(
    "INSERT INTO imports(sourceFile,sourceHash,summary,createdAt) VALUES(?,?,?,?)",
  ).run(
    path.basename(filename),
    hash,
    JSON.stringify({ ...result.summary, inserted, merged }),
    new Date().toISOString(),
  );
})();
console.log(
  JSON.stringify({ inserted, merged, catalogItems: store.products().length }),
);
db.close();
