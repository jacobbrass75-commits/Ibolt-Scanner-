import { createHash } from "node:crypto";
import path from "node:path";
import type { Product } from "../shared/types";
import type { InventoryDatabase } from "../server/db";
import { InventoryStore } from "../server/store";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const catalogHash = (products: Product[]) =>
  hash([...products].sort((a, b) => a.id.localeCompare(b.id)));
const key = (value: string) => value.trim().toLowerCase();
function identities(products: Product[]) {
  const owners = new Map<string, Set<string>>();
  for (const p of products)
    for (const code of [p.sku, p.barcode].filter(Boolean)) {
      const value = owners.get(key(code)) || new Set<string>();
      value.add(p.sku);
      owners.set(key(code), value);
    }
  return owners;
}
export function planCatalog(
  current: Product[],
  incoming: Product[],
  sourceHash: string,
) {
  const beforeHash = catalogHash(current);
  const bySku = new Map(current.map((p) => [key(p.sku), p]));
  const seen = new Set<string>();
  const issues: string[] = [];
  const rows = incoming.map((p) => {
    if (!p.sku || !p.title || seen.has(key(p.sku)))
      throw new Error(
        "Import must contain a title and one row per unique SKU.",
      );
    seen.add(key(p.sku));
    if (
      p.unitWeightOz !== null &&
      (!Number.isFinite(p.unitWeightOz) || p.unitWeightOz <= 0)
    )
      throw new Error(`Invalid part weight for SKU ${p.sku}.`);
    const existing = bySku.get(key(p.sku));
    if (!existing)
      return { before: null, after: p, operation: "insert" as const };
    const after: Product = {
      ...existing,
      title: p.title,
      category: existing.category || p.category,
      barcode: existing.barcode || p.barcode,
      aliases: [...new Set([...existing.aliases, ...p.aliases])],
      source: { ...existing.source, ...p.source },
      updatedAt: new Date(
        Math.max(Date.now(), Date.parse(existing.updatedAt) + 1),
      ).toISOString(),
    };
    if (
      existing.barcode &&
      p.barcode &&
      key(existing.barcode) !== key(p.barcode)
    ) {
      issues.push(
        `${p.sku}: kept existing barcode ${existing.barcode}; source reports ${p.barcode}.`,
      );
      after.aliases = [
        ...new Set([
          ...existing.aliases,
          ...p.aliases.filter((code) => key(code) !== key(p.barcode)),
        ]),
      ];
    }
    if (existing.weightStatus === "verified") {
      if (p.unitWeightOz !== null && p.unitWeightOz !== existing.unitWeightOz)
        issues.push(
          `${p.sku}: preserved measured weight ${existing.unitWeightOz} oz; source reports ${p.unitWeightOz} oz.`,
        );
    } else if (
      existing.weightStatus === "conflict" ||
      p.weightStatus === "conflict" ||
      (existing.unitWeightOz !== null &&
        p.unitWeightOz !== null &&
        existing.unitWeightOz !== p.unitWeightOz)
    ) {
      after.source.weightReconciliation = {
        previousWeightOz: existing.unitWeightOz,
        incomingWeightOz: p.unitWeightOz,
        sourceHash,
      };
      after.unitWeightOz = null;
      after.weightStatus = "conflict";
      after.weightNote =
        "Imported weight sources disagree or contain a flagged value. Measure the part before counting.";
      issues.push(`${p.sku}: weight needs physical review.`);
    } else if (existing.unitWeightOz === null && p.unitWeightOz !== null) {
      after.unitWeightOz = p.unitWeightOz;
      after.weightStatus = "imported";
      after.weightNote = p.weightNote;
    }
    return { before: existing, after, operation: "merge" as const };
  });
  const result = new Map(current.map((p) => [p.id, p]));
  for (const row of rows) {
    if (!row.before && result.has(row.after.id))
      throw new Error("An imported product ID belongs to another SKU.");
    result.set(row.after.id, row.after);
  }
  const baseline = identities(current);
  const conflicts = [...identities([...result.values()])]
    .filter(
      ([code, owners]) =>
        owners.size > 1 &&
        [...owners].some((sku) => !baseline.get(code)?.has(sku)),
    )
    .map(([code, owners]) => ({ code, skus: [...owners].sort() }));
  return {
    rows,
    beforeHash,
    planHash: hash({
      sourceHash,
      beforeHash,
      changes: rows.map(({ before, after, operation }) => ({
        operation,
        beforeId: before?.id || null,
        after: { ...after, updatedAt: undefined },
      })),
    }),
    sourceHash,
    summary: {
      inserted: rows.filter((r) => r.operation === "insert").length,
      merged: rows.filter((r) => r.operation === "merge").length,
      preservedMeasured: rows.filter(
        (r) => r.before?.weightStatus === "verified",
      ).length,
      resultingItems: result.size,
      barcodeConflicts: conflicts,
      notes: issues,
    },
  };
}
export function applyCatalog(
  db: InventoryDatabase,
  plan: ReturnType<typeof planCatalog>,
  sourceFile: string,
  sourceSummary: Record<string, unknown>,
) {
  const store = new InventoryStore(db, "catalog-import");
  if (plan.summary.barcodeConflicts.length)
    throw new Error(
      "Import introduces barcode/SKU collisions. Resolve the preview conflicts first.",
    );
  return db
    .transaction(() => {
      if (
        db
          .prepare("SELECT id FROM imports WHERE sourceHash=?")
          .get(plan.sourceHash)
      )
        return { alreadyImported: true };
      if (catalogHash(store.products()) !== plan.beforeHash)
        throw new Error(
          "The catalog changed after preview. Preview again before applying.",
        );
      for (const row of plan.rows) {
        const value = {
          ...row.after,
          aliases: JSON.stringify(row.after.aliases),
          source: JSON.stringify(row.after.source),
        };
        const fields = Object.keys(value);
        db.prepare(
          `INSERT INTO products(${fields.join(",")}) VALUES(${fields.map((k) => "@" + k).join(",")}) ON CONFLICT(id) DO UPDATE SET ${fields
            .filter((k) => k !== "id")
            .map((k) => `${k}=excluded.${k}`)
            .join(",")}`,
        ).run(value);
        store.audit("catalog_import", row.after.id, row.before, row.after);
      }
      db.prepare(
        "INSERT INTO imports(sourceFile,sourceHash,summary,createdAt) VALUES(?,?,?,?)",
      ).run(
        path.basename(sourceFile),
        plan.sourceHash,
        JSON.stringify({ ...sourceSummary, ...plan.summary }),
        new Date().toISOString(),
      );
      return { alreadyImported: false, ...plan.summary };
    })
    .immediate();
}
