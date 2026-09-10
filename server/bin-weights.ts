import type { BinWeight } from "../shared/types";
import { InventoryStore } from "./store";
import { InventoryError } from "./errors";

export function binWeights(store: InventoryStore): BinWeight[] {
  return (
    store.db
      .prepare(
        "SELECT * FROM bin_weights ORDER BY sourceFile, sheet, sourceRow, binNumber",
      )
      .all() as any[]
  ).map((row) => ({
    ...row,
    candidateProductIds: JSON.parse(row.candidateProductIds),
  }));
}

export function setUpImportedBin(
  store: InventoryStore,
  id: string,
  input: {
    productId: string;
    binLabel: string;
    unitWeightOz: number;
    emptyBinWeightOz: number;
    location: string;
    notes: string;
    expectedUpdatedAt: string;
  },
) {
  return store.db
    .transaction(() => {
      const record = binWeights(store).find((row) => row.id === id);
      if (!record) throw new InventoryError("Bin measurement not found.", 404);
      if (record.binId)
        throw new InventoryError(
          "This measurement already has a bin. Open that bin instead.",
          409,
        );
      if (record.updatedAt !== input.expectedUpdatedAt)
        throw new InventoryError(
          "This measurement changed. Reload it before setting up the bin.",
          409,
        );
      const bin = store.createBin({
        ...input,
        notes: [
          input.notes,
          `Source: ${record.sourceFile}, ${record.sheet}!${record.sourceCell}; part ${record.sku}; recorded bin weight ${record.binWeightLb} lb. This source weight has not been saved as a physical count.`,
        ]
          .filter(Boolean)
          .join("\n"),
      });
      const updatedAt = new Date(
        Math.max(Date.now(), Date.parse(record.updatedAt) + 1),
      ).toISOString();
      store.db
        .prepare(
          "UPDATE bin_weights SET productId=?, binId=?, updatedAt=? WHERE id=?",
        )
        .run(bin.productId, bin.id, updatedAt, id);
      store.audit("bin_weight_setup", id, record, {
        ...record,
        productId: bin.productId,
        binId: bin.id,
        updatedAt,
      });
      return bin;
    })
    .immediate();
}
