import { createHash } from "node:crypto";
import { z } from "zod";
import type { Bin, Product } from "../shared/types";
import type { InventoryDatabase } from "../server/db";
import { InventoryStore } from "../server/store";

const fingerprint = (rows: Bin[]) =>
  createHash("sha256")
    .update(JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id))))
    .digest("hex");
const timestamp = z
  .number()
  .int()
  .nonnegative()
  .transform((v) => new Date(v * 1000).toISOString());
const legacyBin = z
  .object({
    id: z.string().min(1),
    product_id: z.string().min(1),
    sku: z.string().min(1),
    product_title: z.string(),
    bin_label: z.string().min(1),
    qr_code: z.string().min(1),
    unit_weight_oz: z.number().positive(),
    empty_bin_weight_oz: z.number().nonnegative(),
    location: z.string().nullable(),
    notes: z.string().nullable(),
    created_at: timestamp,
    updated_at: timestamp,
    last_quantity: z.null(),
    last_count_at: z.null(),
  })
  .passthrough();

// This explicit migration preserves uncalibrated legacy records as history.
// Active bins must be created through the measured-weight workflow.
export function planHistoricalBins(
  current: Bin[],
  raw: unknown[],
  counts: unknown[],
  products: Product[],
) {
  if (counts.length)
    throw new Error(
      "Historical-bin migration requires separate reconciliation of source count history.",
    );
  const knownIds = new Set(current.map((b) => b.id));
  const knownCodes = new Set(current.map((b) => b.qrCode.toLowerCase()));
  const rows = raw.map((value) => {
    const b = legacyBin.parse(value);
    if (knownIds.has(b.id) || knownCodes.has(b.qr_code.toLowerCase()))
      throw new Error(
        "A legacy bin ID or QR code already exists. Preserve the current record and reconcile separately.",
      );
    knownIds.add(b.id);
    knownCodes.add(b.qr_code.toLowerCase());
    const matches = products.filter((p) =>
      [
        p.source.legacyProductId,
        ...((p.source.legacyProductIds || []) as unknown[]),
      ].includes(b.product_id),
    );
    if (
      matches.length !== 1 ||
      matches[0].sku.toLowerCase() !== b.sku.toLowerCase()
    )
      throw new Error("Legacy bin product identity is ambiguous or missing.");
    const after: Bin = {
      id: b.id,
      productId: matches[0].id,
      sku: b.sku,
      productTitle: b.product_title,
      binLabel: b.bin_label,
      qrCode: b.qr_code,
      unitWeightOz: b.unit_weight_oz,
      emptyBinWeightOz: b.empty_bin_weight_oz,
      location: b.location || "",
      notes: [
        b.notes,
        "Imported historical bin. Legacy tare and part weight are unverified; create a measured bin before operational counting.",
      ]
        .filter(Boolean)
        .join("\n"),
      status: "archived",
      lastQuantity: null,
      lastCountAt: null,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    };
    return { before: value, after };
  });
  const beforeHash = fingerprint(current);
  return {
    rows,
    beforeHash,
    planHash: createHash("sha256")
      .update(JSON.stringify({ beforeHash, rows }))
      .digest("hex"),
  };
}

export function applyHistoricalBins(
  db: InventoryDatabase,
  plan: ReturnType<typeof planHistoricalBins>,
) {
  const store = new InventoryStore(db, "catalog-import");
  if (fingerprint(store.bins(true)) !== plan.beforeHash)
    throw new Error(
      "Bins changed after preview. Preview again before applying.",
    );
  for (const row of plan.rows) {
    const fields = Object.keys(row.after);
    db.prepare(
      `INSERT INTO bins(${fields.join(",")}) VALUES(${fields.map((f) => "@" + f).join(",")})`,
    ).run(row.after);
    store.audit("legacy_bin_archived", row.after.id, row.before, row.after);
  }
}
