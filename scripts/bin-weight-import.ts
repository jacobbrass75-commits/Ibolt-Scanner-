import { createHash } from "node:crypto";
import type { Product } from "../shared/types";
import type { InventoryDatabase } from "../server/db";
import { InventoryStore } from "../server/store";
import type { WeightSheetRow } from "./bin-weight-workbook";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const key = (value: string) => value.trim().toLowerCase();
export function planBinWeights(
  products: Product[],
  rows: WeightSheetRow[],
  sourceHash: string,
  sourceFile: string,
  sourceNote: string,
) {
  const sorted = [...products].sort((a, b) => a.id.localeCompare(b.id));
  const matched = rows.map((row) => ({
    ...row,
    candidates: sorted.filter((p) =>
      [p.sku, ...p.aliases].some((code) => key(code) === key(row.sku)),
    ),
  }));
  const changes: { before: Product; after: Product }[] = [];
  const preservedVerified: string[] = [],
    conflictingPartWeights: string[] = [];
  for (const product of sorted) {
    const entries = matched.filter(
      (row) =>
        row.candidates.length === 1 &&
        row.candidates[0].id === product.id &&
        row.partWeightOz !== null,
    );
    if (!entries.length) continue;
    const weights = [...new Set(entries.map((r) => r.partWeightOz!))];
    const conflicting = weights.length !== 1;
    if (conflicting) conflictingPartWeights.push(product.sku);
    if (product.weightStatus === "verified")
      preservedVerified.push(product.sku);
    const canUpdate = !conflicting && product.weightStatus !== "verified";
    const existingEvidence = Array.isArray(product.source.binWeightSources)
      ? product.source.binWeightSources
      : [];
    const after: Product = {
      ...product,
      ...(canUpdate
        ? {
            unitWeightOz: weights[0],
            weightStatus: "imported" as const,
            weightNote:
              `Part weight from ${sourceFile}, ${entries.map((r) => `${r.sheet}!B${r.row}`).join(", ")}. ${product.weightNote}`.trim(),
          }
        : {}),
      source: {
        ...product.source,
        binWeightSources: [
          ...existingEvidence,
          ...entries.map((r) => ({
            sourceHash,
            sourceFile,
            sourceNote,
            sheet: r.sheet,
            row: r.row,
            cell: `B${r.row}`,
            rawWeight: r.rawPartWeight,
            weightOz: r.partWeightOz,
          })),
        ],
      },
    };
    changes.push({ before: product, after });
  }
  const measurements = matched.flatMap((row) =>
    row.bins.map((bin) => ({
      id: "weight-" + hash([sourceHash, row.sheet, bin.cell]).slice(0, 32),
      sourceHash,
      sourceFile,
      sheet: row.sheet,
      sourceRow: row.row,
      sourceCell: bin.cell,
      sku: row.sku,
      binNumber: bin.number,
      rawPartWeight: row.rawPartWeight,
      partWeightOz: row.partWeightOz,
      rawBinWeight: bin.raw,
      binWeightLb: bin.weightLb,
      productId: row.candidates.length === 1 ? row.candidates[0].id : null,
      candidateProductIds: row.candidates.map((p) => p.id),
      binId: null,
    })),
  );
  if (new Set(measurements.map((m) => m.id)).size !== measurements.length)
    throw new Error("Duplicate source cells found. Nothing imported.");
  const summary = {
    sourceNote,
    sourceRows: rows.length,
    distinctParts: new Set(rows.map((r) => key(r.sku))).size,
    binMeasurements: measurements.length,
    partWeightRows: rows.filter((r) => r.partWeightOz !== null).length,
    matchedRows: matched.filter((r) => r.candidates.length === 1).length,
    unmatched: matched
      .filter((r) => !r.candidates.length)
      .map((r) => ({ sku: r.sku, sheet: r.sheet, row: r.row })),
    ambiguous: matched
      .filter((r) => r.candidates.length > 1)
      .map((r) => ({
        sku: r.sku,
        sheet: r.sheet,
        row: r.row,
        candidates: r.candidates.map((p) => ({ id: p.id, title: p.title })),
      })),
    preservedVerified,
    conflictingPartWeights,
    weightUpdates: changes
      .filter(
        (c) =>
          c.after.weightStatus === "imported" &&
          c.before.weightStatus !== "verified" &&
          !conflictingPartWeights.includes(c.before.sku),
      )
      .map((c) => ({
        id: c.before.id,
        sku: c.before.sku,
        beforeOz: c.before.unitWeightOz,
        afterOz: c.after.unitWeightOz,
      })),
    activeBinsCreated: 0,
    countsCreated: 0,
    measurementBasis:
      "Unconfirmed: the sheet does not specify container tare or whether bin weights include the container.",
  };
  return {
    sourceHash,
    sourceFile,
    sourceNote,
    rows,
    changes,
    measurements,
    summary,
    planHash: hash({
      products: sorted,
      rows,
      sourceHash,
      sourceFile,
      sourceNote,
    }),
  };
}

export function applyBinWeights(
  db: InventoryDatabase,
  plan: ReturnType<typeof planBinWeights>,
) {
  return db
    .transaction(() => {
      if (
        db
          .prepare("SELECT id FROM imports WHERE sourceHash=?")
          .get(plan.sourceHash)
      )
        return { alreadyImported: true, measurements: 0 };
      const store = new InventoryStore(db, "bin-weight-import");
      const current = planBinWeights(
        store.products(),
        plan.rows,
        plan.sourceHash,
        plan.sourceFile,
        plan.sourceNote,
      );
      if (current.planHash !== plan.planHash)
        throw new Error(
          "Catalog changed after preview. Preview the import again before applying.",
        );
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO imports(sourceFile,sourceHash,summary,createdAt) VALUES(?,?,?,?)",
      ).run(
        plan.sourceFile,
        plan.sourceHash,
        JSON.stringify({ ...plan.summary, rows: plan.rows }),
        now,
      );
      const update = db.prepare(
        "UPDATE products SET unitWeightOz=?, weightStatus=?, weightNote=?, source=?, updatedAt=? WHERE id=?",
      );
      for (const change of plan.changes) {
        const after = {
          ...change.after,
          updatedAt: new Date(
            Math.max(Date.now(), Date.parse(change.before.updatedAt) + 1),
          ).toISOString(),
        };
        update.run(
          after.unitWeightOz,
          after.weightStatus,
          after.weightNote,
          JSON.stringify(after.source),
          after.updatedAt,
          after.id,
        );
        store.audit("bin_sheet_part_weight", after.id, change.before, after);
      }
      const insert =
        db.prepare(`INSERT INTO bin_weights(id,sourceHash,sourceFile,sheet,sourceRow,sourceCell,sku,binNumber,rawPartWeight,partWeightOz,rawBinWeight,binWeightLb,productId,candidateProductIds,binId,createdAt,updatedAt)
      VALUES(@id,@sourceHash,@sourceFile,@sheet,@sourceRow,@sourceCell,@sku,@binNumber,@rawPartWeight,@partWeightOz,@rawBinWeight,@binWeightLb,@productId,@candidateProductIds,@binId,@createdAt,@updatedAt)`);
      for (const measurement of plan.measurements) {
        const row = { ...measurement, createdAt: now, updatedAt: now };
        insert.run({
          ...row,
          candidateProductIds: JSON.stringify(row.candidateProductIds),
        });
        store.audit("bin_weight_imported", row.id, null, row);
      }
      return {
        alreadyImported: false,
        measurements: plan.measurements.length,
        partWeights: plan.summary.weightUpdates.length,
      };
    })
    .immediate();
}
