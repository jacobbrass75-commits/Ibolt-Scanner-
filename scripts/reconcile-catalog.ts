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
      value.add(p.id);
      owners.set(key(code), value);
    }
  return owners;
}
export function planCatalog(
  current: Product[],
  incoming: Product[],
  sourceHash: string,
  options: { allowSharedCodes?: boolean } = {},
) {
  const beforeHash = catalogHash(current);
  const result = new Map(current.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const issues: string[] = [];
  const rows = incoming.map((p) => {
    if (!p.sku || !p.title || seen.has(p.id))
      throw new Error(
        "Import must contain a title and one row per unique source identity.",
      );
    seen.add(p.id);
    if (
      p.unitWeightOz !== null &&
      (!Number.isFinite(p.unitWeightOz) || p.unitWeightOz <= 0)
    )
      throw new Error(`Invalid part weight for SKU ${p.sku}.`);
    const candidates = [...result.values()].filter((old) => {
      if (p.source.variantId)
        return (
          String(old.source.variantId || "") === String(p.source.variantId)
        );
      if (p.source.legacySourceType === "inventory_weight_sheet") {
        const ids = [
          old.source.legacyProductId,
          ...((old.source.legacyProductIds || []) as unknown[]),
        ];
        if (ids.includes(p.source.legacyProductId)) return true;
        // Match workbook evidence already attached to this physical part, not
        // just an equal SKU on a different Shopify variant.
        const rowNumbers = (source: Record<string, unknown>) =>
          ((source.rows || source.weightRows || []) as any[])
            .map((r) => Number(r.row ?? r.sourceRow))
            .sort((a, b) => a - b)
            .join(",");
        return (
          key(old.sku) === key(p.sku) &&
          Boolean(p.source.workbook) &&
          old.source.workbook === p.source.workbook &&
          old.source.sheet === p.source.sheet &&
          Boolean(rowNumbers(p.source)) &&
          rowNumbers(old.source) === rowNumbers(p.source)
        );
      }
      return key(old.sku) === key(p.sku);
    });
    if (candidates.length > 1)
      throw new Error(
        `Ambiguous source identity for ${p.sku}; reconcile the source IDs first.`,
      );
    const existing = candidates[0];
    if (!existing) {
      let after = p;
      if (result.has(after.id)) {
        if (!p.source.legacyProductId)
          throw new Error(
            "An imported product ID belongs to another identity.",
          );
        after = { ...p, id: `legacy-${p.source.legacyProductId}` };
      }
      if (result.has(after.id)) throw new Error("Duplicate imported identity.");
      result.set(after.id, after);
      return { before: null, after, operation: "insert" as const };
    }
    const after: Product = {
      ...existing,
      sku: p.source.variantId ? p.sku : existing.sku,
      title: p.title,
      category: existing.category || p.category,
      barcode: existing.barcode || p.barcode,
      aliases: [...new Set([...existing.aliases, ...p.aliases])],
      source: { ...existing.source, ...p.source },
      updatedAt: new Date(
        Math.max(Date.now(), Date.parse(existing.updatedAt) + 1),
      ).toISOString(),
    };
    after.source.legacyProductIds = [
      ...new Set(
        [
          existing.source.legacyProductId,
          ...((existing.source.legacyProductIds || []) as unknown[]),
          p.source.legacyProductId,
          ...((p.source.legacyProductIds || []) as unknown[]),
        ].filter(Boolean),
      ),
    ];
    if (!p.source.variantId && existing.source.variantId) {
      after.source.variantId = existing.source.variantId;
      after.source.shopifyProductId = existing.source.shopifyProductId;
    }
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
    result.set(after.id, after);
    return { before: existing, after, operation: "merge" as const };
  });
  const baseline = identities(current);
  const conflicts = [...identities([...result.values()])]
    .filter(
      ([code, owners]) =>
        owners.size > 1 &&
        [...owners].some((id) => !baseline.get(code)?.has(id)),
    )
    .map(([code, owners]) => ({
      code,
      items: [...owners].sort().map((id) => ({ id, sku: result.get(id)!.sku })),
    }));
  return {
    rows,
    beforeHash,
    planHash: hash({
      sourceHash,
      beforeHash,
      allowSharedCodes: Boolean(options.allowSharedCodes),
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
      barcodeConflicts: options.allowSharedCodes ? [] : conflicts,
      sharedCodes: options.allowSharedCodes ? conflicts : [],
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
