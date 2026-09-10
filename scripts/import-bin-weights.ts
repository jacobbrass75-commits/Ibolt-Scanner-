import "dotenv/config";
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { readBinWeightWorkbook } from "./bin-weight-workbook";
import { planBinWeights, applyBinWeights } from "./bin-weight-import";
import { InventoryStore } from "../server/store";
import { createBackup, inspectBackup } from "../server/backups";
import { openDatabase } from "../server/db";

const args = parseArgs({
  allowPositionals: true,
  options: {
    database: { type: "string" },
    "source-note": { type: "string" },
    apply: { type: "boolean" },
    "expect-plan": { type: "string" },
    "expect-source": { type: "string" },
  },
});
const [filename, ...extra] = args.positionals;
if (!filename || extra.length || !args.values.database)
  throw new Error(
    "Usage: npm run import:bin-weights -- source.xlsx --database inventory.sqlite [--source-note provenance] [--apply --expect-plan SHA256 --expect-source SHA256]",
  );
const target = path.resolve(args.values.database);
if (path.resolve(filename) === target)
  throw new Error("Source and target must be different files.");
const bytes = await readFile(filename);
const sourceHash = createHash("sha256").update(bytes).digest("hex");
if (args.values["expect-source"] && sourceHash !== args.values["expect-source"])
  throw new Error("Source checksum changed. Nothing imported.");
inspectBackup(target);
const previewDb = new Database(target, { readonly: true, fileMustExist: true });
try {
  if (
    previewDb
      .prepare("SELECT id FROM imports WHERE sourceHash=?")
      .get(sourceHash)
  ) {
    console.log(JSON.stringify({ alreadyImported: true, sourceHash }));
  } else {
    const rows = await readBinWeightWorkbook(bytes);
    const plan = planBinWeights(
      new InventoryStore(previewDb).products(),
      rows,
      sourceHash,
      path.basename(filename),
      args.values["source-note"] || "",
    );
    console.log(
      JSON.stringify(
        { sourceHash, planHash: plan.planHash, ...plan.summary },
        null,
        2,
      ),
    );
    if (args.values.apply) {
      if (
        args.values["expect-plan"] !== plan.planHash ||
        args.values["expect-source"] !== sourceHash
      )
        throw new Error(
          "Apply requires both hashes from the reviewed preview.",
        );
      if (
        createHash("sha256")
          .update(await readFile(filename))
          .digest("hex") !== sourceHash
      )
        throw new Error("Workbook changed during preview. Nothing imported.");
      console.log(
        JSON.stringify({
          preImportBackup: await createBackup(
            previewDb,
            process.env.BACKUP_DIR ||
              path.join(path.dirname(target), "backups"),
          ),
        }),
      );
      const db = openDatabase(target);
      try {
        console.log(JSON.stringify(applyBinWeights(db, plan)));
      } finally {
        db.close();
      }
    }
  }
} finally {
  previewDb.close();
}
