import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import path from "node:path";
import Database from "better-sqlite3";
import {
  readWeightWorkbook,
  readLegacyCatalog,
  readLegacyTransfer,
} from "./catalog";
import { planCatalog, applyCatalog } from "./reconcile-catalog";
import { openDatabase } from "../server/db";
import { InventoryStore } from "../server/store";
import { createBackup } from "../server/backups";

const args = parseArgs({
  allowPositionals: true,
  options: {
    apply: { type: "boolean" },
    "expect-plan": { type: "string" },
    "expect-source": { type: "string" },
    database: { type: "string" },
  },
});
const [filename, ...extra] = args.positionals;
if (!filename || extra.length)
  throw new Error(
    "Usage: npm run import:catalog -- source.xlsx|source.sqlite|inventory-transfer.json.txt [--database target.sqlite] [--expect-source SHA256] [--apply --expect-plan PREVIEW_HASH]",
  );
const target = path.resolve(
  args.values.database || process.env.DATABASE_PATH || "data/inventory.sqlite",
);
if (path.resolve(filename) === target)
  throw new Error("Source and destination must be different files.");
const sourceHash = createHash("sha256")
  .update(await readFile(filename))
  .digest("hex");
if (args.values["expect-source"] && args.values["expect-source"] !== sourceHash)
  throw new Error(
    "Source checksum differs from the supplied manifest. Nothing imported.",
  );
const result = /\.xlsx$/i.test(filename)
  ? await readWeightWorkbook(filename)
  : /\.json(?:\.txt)?$/i.test(filename)
    ? await readLegacyTransfer(filename)
    : readLegacyCatalog(filename);
const existing = existsSync(target);
const previewDb = existing
  ? new Database(target, { readonly: true, fileMustExist: true })
  : null;
let plan: ReturnType<typeof planCatalog>;
try {
  if (
    previewDb &&
    previewDb
      .prepare("SELECT id FROM imports WHERE sourceHash=?")
      .get(sourceHash)
  ) {
    console.log("This exact source is already imported. No changes made.");
    process.exitCode = 0;
  } else {
    plan = planCatalog(
      previewDb ? new InventoryStore(previewDb).products() : [],
      result.products,
      sourceHash,
    );
    console.log(
      JSON.stringify(
        {
          source: result.summary,
          destination: target,
          sourceHash,
          planHash: plan.planHash,
          ...plan.summary,
        },
        null,
        2,
      ),
    );
    if (args.values.apply) {
      if (args.values["expect-plan"] !== plan.planHash)
        throw new Error(
          "Apply requires --expect-plan with the current preview hash. Preview and review the changes first.",
        );
      if (plan.summary.barcodeConflicts.length)
        throw new Error(
          "Resolve barcode/SKU collisions before applying this import.",
        );
      if (
        createHash("sha256")
          .update(await readFile(filename))
          .digest("hex") !== sourceHash
      )
        throw new Error(
          "Source changed while being read. Export a stable snapshot and preview again.",
        );
      if (previewDb) {
        const backup = await createBackup(
          previewDb,
          process.env.BACKUP_DIR || path.join(path.dirname(target), "backups"),
        );
        console.log(
          JSON.stringify({
            preImportBackup: backup.filename,
            manifest: backup.manifest,
          }),
        );
      }
      const destination = openDatabase(target);
      try {
        console.log(
          JSON.stringify(
            applyCatalog(destination, plan, filename, result.summary),
          ),
        );
      } finally {
        destination.close();
      }
    } else
      console.log(
        "Preview only. Apply using --apply --expect-plan followed by the preview hash. Bins and count history remain untouched.",
      );
  }
} finally {
  previewDb?.close();
}
