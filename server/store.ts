import { randomUUID } from "node:crypto";
import type { InventoryDatabase } from "./db";
import type { Product, Bin, Count, Calculation } from "../shared/types";
import { calculate, normalizeScan } from "./domain";
const nextTimestamp = (previous: string) =>
  new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();

export class InventoryStore {
  constructor(public db: InventoryDatabase) {}
  products(): Product[] {
    return (
      this.db
        .prepare("SELECT * FROM products ORDER BY sku COLLATE NOCASE")
        .all() as any[]
    ).map((p) => ({
      ...p,
      aliases: JSON.parse(p.aliases),
      source: JSON.parse(p.source),
    }));
  }
  product(id: string): Product {
    const p = this.products().find((p) => p.id === id);
    if (!p) throw new Error("Product not found.");
    return p;
  }
  bins(archived = false): Bin[] {
    return this.db
      .prepare(
        `SELECT * FROM bins ${archived ? "" : "WHERE status = 'active'"} ORDER BY binLabel COLLATE NOCASE`,
      )
      .all() as Bin[];
  }
  bin(id: string): Bin {
    const b = this.db.prepare("SELECT * FROM bins WHERE id = ?").get(id) as
      | Bin
      | undefined;
    if (!b) throw new Error("Bin not found.");
    return b;
  }
  audit(kind: string, id: string, before: unknown, after: unknown) {
    this.db
      .prepare(
        "INSERT INTO audit(kind,recordId,beforeValue,afterValue,createdAt) VALUES(?,?,?,?,?)",
      )
      .run(
        kind,
        id,
        JSON.stringify(before),
        JSON.stringify(after),
        new Date().toISOString(),
      );
  }
  updateProduct(
    id: string,
    input: {
      unitWeightOz: number;
      barcode: string;
      category: string;
      weightNote: string;
      expectedUpdatedAt: string;
    },
  ): Product {
    return this.db.transaction(() => {
      const before = this.product(id);
      if (before.updatedAt !== input.expectedUpdatedAt)
        throw new Error("This product changed. Reload it before saving.");
      if (
        input.barcode &&
        this.products().some(
          (p) =>
            p.id !== id &&
            [p.sku, p.barcode, ...p.aliases].some(
              (a) => a.toLowerCase() === input.barcode.toLowerCase(),
            ),
        )
      )
        throw new Error(
          "This barcode belongs to another catalog item. Check the label before assigning it.",
        );
      this.db
        .prepare(
          "UPDATE products SET unitWeightOz=?, barcode=?, category=?, weightNote=?, weightStatus='verified', updatedAt=? WHERE id=?",
        )
        .run(
          input.unitWeightOz,
          input.barcode,
          input.category,
          input.weightNote,
          nextTimestamp(before.updatedAt),
          id,
        );
      const after = this.product(id);
      this.audit("product_measurement", id, before, after);
      return after;
    })();
  }
  createBin(input: {
    productId: string;
    binLabel: string;
    unitWeightOz: number;
    emptyBinWeightOz: number;
    location: string;
    notes: string;
  }): Bin {
    return this.db.transaction(() => {
      const p = this.product(input.productId),
        now = new Date().toISOString();
      const id = randomUUID(),
        qrCode = `IBOLT-${p.sku.replace(/[^a-z0-9-]/gi, "").slice(0, 20)}-${randomUUID().slice(0, 8).toUpperCase()}`;
      this.db
        .prepare(
          "INSERT INTO bins(id,productId,sku,productTitle,binLabel,qrCode,unitWeightOz,emptyBinWeightOz,location,notes,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          p.id,
          p.sku,
          p.title,
          input.binLabel,
          qrCode,
          input.unitWeightOz,
          input.emptyBinWeightOz,
          input.location,
          input.notes,
          now,
          now,
        );
      const b = this.bin(id);
      this.audit("bin_created", id, null, b);
      return b;
    })();
  }
  updateBin(
    id: string,
    input: {
      binLabel: string;
      unitWeightOz: number;
      emptyBinWeightOz: number;
      location: string;
      notes: string;
      expectedUpdatedAt: string;
    },
  ): Bin {
    return this.db.transaction(() => {
      const b = this.bin(id);
      if (b.updatedAt !== input.expectedUpdatedAt)
        throw new Error("This bin changed. Reload it before saving.");
      if (b.status !== "active")
        throw new Error("Archived bins cannot be edited.");
      this.db
        .prepare(
          "UPDATE bins SET binLabel=?,unitWeightOz=?,emptyBinWeightOz=?,location=?,notes=?,updatedAt=? WHERE id=?",
        )
        .run(
          input.binLabel,
          input.unitWeightOz,
          input.emptyBinWeightOz,
          input.location,
          input.notes,
          nextTimestamp(b.updatedAt),
          id,
        );
      const after = this.bin(id);
      this.audit("bin_updated", id, b, after);
      return after;
    })();
  }
  archiveBin(id: string) {
    return this.db.transaction(() => {
      const b = this.bin(id);
      this.db
        .prepare("UPDATE bins SET status='archived',updatedAt=? WHERE id=?")
        .run(nextTimestamp(b.updatedAt), id);
      this.audit("bin_archived", id, b, this.bin(id));
      return this.bin(id);
    })();
  }
  lookup(raw: string) {
    const code = normalizeScan(raw),
      key = code.toLowerCase();
    if (!code) throw new Error("Scan or enter a bin code, SKU, or barcode.");
    const direct = this.bins().filter(
      (b) => b.qrCode.toLowerCase() === key || b.id.toLowerCase() === key,
    );
    if (direct.length) return { code, bins: direct, products: [] };
    const products = this.products().filter((p) =>
      [p.sku, p.barcode, ...p.aliases].some(
        (v) => v && v.toLowerCase() === key,
      ),
    );
    const ids = new Set(products.map((p) => p.id));
    const bins = this.bins().filter(
      (b) => ids.has(b.productId) || b.sku.toLowerCase() === key,
    );
    return { code, bins, products };
  }
  counts(): Count[] {
    return this.db
      .prepare("SELECT * FROM counts ORDER BY createdAt DESC, rowid DESC")
      .all() as Count[];
  }
  calculate(input: {
    binId: string;
    totalWeight: number;
    weightUnit: "oz" | "lb" | "g" | "kg";
    roundingMode: Count["roundingMode"];
    save: boolean;
    requestId?: string;
    expectedBinUpdatedAt?: string;
    countedBy: string;
    notes: string;
  }): Calculation {
    return this.db.transaction(() => {
      const bin = this.bin(input.binId);
      if (input.save && input.requestId) {
        const existing = this.db
          .prepare("SELECT * FROM counts WHERE requestId = ?")
          .get(input.requestId) as Count | undefined;
        if (existing) {
          const repeated = calculate(
            input.totalWeight,
            input.weightUnit,
            existing.emptyBinWeightOz,
            existing.unitWeightOz,
            input.roundingMode,
          );
          if (
            existing.binId !== input.binId ||
            Math.abs(existing.totalWeightOz - repeated.totalWeightOz) > 1e-9 ||
            existing.roundingMode !== input.roundingMode ||
            existing.countedBy !== input.countedBy ||
            existing.notes !== input.notes
          )
            throw new Error(
              "Count request already used for different inputs. Preview again.",
            );
          return { bin, ...repeated, count: existing };
        }
      }
      if (bin.status !== "active")
        throw new Error("This bin is archived. Choose an active bin.");
      if (input.save && (!input.requestId || !input.expectedBinUpdatedAt))
        throw new Error("Preview this count before saving.");
      if (input.save && input.expectedBinUpdatedAt !== bin.updatedAt)
        throw new Error(
          "The bin changed since your preview. Preview again before saving.",
        );
      const result = calculate(
        input.totalWeight,
        input.weightUnit,
        bin.emptyBinWeightOz,
        bin.unitWeightOz,
        input.roundingMode,
      );
      let count: Count | null = null;
      if (input.save) {
        const now = nextTimestamp(bin.updatedAt);
        count = {
          id: randomUUID(),
          requestId: input.requestId!,
          binId: bin.id,
          sku: bin.sku,
          binLabel: bin.binLabel,
          productTitle: bin.productTitle,
          ...result,
          countedBy: input.countedBy,
          notes: input.notes,
          createdAt: now,
        };
        const keys = Object.keys(count);
        this.db
          .prepare(
            `INSERT INTO counts(${keys.join(",")}) VALUES(${keys.map((k) => "@" + k).join(",")})`,
          )
          .run(count);
        this.db
          .prepare(
            "UPDATE bins SET lastQuantity=?,lastCountAt=?,updatedAt=? WHERE id=?",
          )
          .run(count.quantity, now, now, bin.id);
      }
      return { bin: this.bin(bin.id), ...result, count };
    })();
  }
}
