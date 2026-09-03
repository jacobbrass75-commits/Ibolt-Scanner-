import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { Product } from "../shared/types";
import { z } from "zod";

const arr = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
const string = (v: unknown) =>
  v === null || v === undefined ? "" : String(v).trim();
const json = (s: unknown): any => {
  if (s && typeof s === "object") return s;
  try {
    return JSON.parse(String(s || "{}"));
  } catch {
    return {};
  }
};
export function parseWeight(raw: unknown): number | null {
  const s = string(raw).toLowerCase();
  let n: number | null = null;
  if (/^\d+(?:\.\d+)?$/.test(s)) n = Number(s);
  else if (/^\d+(?:\.\d+)?\s*oz$/.test(s)) n = parseFloat(s);
  else {
    const match = s.match(
      /^(\d+(?:\.\d+)?)\s*lbs?(?:\s+(\d+(?:\.\d+)?)\s*oz)?$/,
    );
    if (match) n = Number(match[1]) * 16 + Number(match[2] || 0);
  }
  return n !== null && Number.isFinite(n) && n > 0 ? n : null;
}
export function categoryFor(title: string) {
  if (/cable|usb|charger/i.test(title)) return "Cables & chargers";
  if (/screw|bolt|nut|adhesive|hex key|knob/i.test(title))
    return "Hardware & service parts";
  if (/holder|dock|grip/i.test(title)) return "Device holders";
  if (/arm|shaft|extension|gooseneck/i.test(title)) return "Arms & extensions";
  if (/clamp|handlebar|claw/i.test(title)) return "Clamps & handlebars";
  if (/plate|ball|adapter|amps/i.test(title)) return "Plates & adapters";
  if (/suction|base|vent/i.test(title)) return "Bases";
  return "Mounting parts";
}
function makeProduct(
  sku: string,
  title: string,
  source: Record<string, unknown>,
): Product {
  return {
    id:
      "part-" +
      createHash("sha256").update(sku.toLowerCase()).digest("hex").slice(0, 24),
    sku,
    title,
    barcode: "",
    aliases: [],
    category: categoryFor(title),
    unitWeightOz: null,
    weightStatus: "missing",
    weightNote: "",
    source,
    updatedAt: new Date().toISOString(),
  };
}
export async function readWeightWorkbook(filename: string) {
  const zip = await JSZip.loadAsync(await readFile(filename));
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: false,
    processEntities: true,
  });
  const xml = async (key: string) =>
    parser.parse(await zip.file(key)!.async("text"));
  const workbook = await xml("xl/workbook.xml");
  const sheets = arr<any>(workbook.workbook.sheets.sheet);
  const matched = sheets.find((s) => s["@_name"] === "Matched Parts");
  if (!matched)
    throw new Error("Workbook must contain the Matched Parts sheet.");
  const rels = await xml("xl/_rels/workbook.xml.rels");
  const target = arr<any>(rels.Relationships.Relationship).find(
    (r) => r["@_Id"] === matched["@_r:id"],
  )?.["@_Target"];
  if (!target)
    throw new Error("Matched Parts worksheet relationship is missing.");
  const sheetPath = target.startsWith("/")
    ? target.slice(1)
    : path.posix.normalize("xl/" + target);
  const richText = (v: any): string =>
    typeof v === "string"
      ? v
      : v?.t !== undefined
        ? richText(v.t)
        : v?.["#text"] !== undefined
          ? String(v["#text"])
          : v?.r
            ? arr(v.r).map(richText).join("")
            : "";
  const shared = zip.file("xl/sharedStrings.xml")
    ? arr<any>((await xml("xl/sharedStrings.xml")).sst.si).map(richText)
    : [];
  const sheet = await xml(sheetPath);
  const rows = arr<any>(sheet.worksheet.sheetData.row).map((row) => {
    const fields = new Map<string, string>();
    for (const c of arr<any>(row.c)) {
      const column = String(c["@_r"]).replace(/\d/g, "");
      fields.set(
        column,
        c["@_t"] === "s"
          ? shared[Number(c.v)] || ""
          : c["@_t"] === "inlineStr"
            ? richText(c.is)
            : string(c.v),
      );
    }
    return { number: Number(row["@_r"]), fields };
  });
  const header = rows.find((r) =>
    [...r.fields.values()].includes("PART NUMBER"),
  );
  if (!header) throw new Error("PART NUMBER header is missing.");
  const columnFor = (name: string) =>
    [...header.fields].find(([, v]) => v.trim() === name)?.[0] || "";
  const groups = new Map<
    string,
    {
      row: number;
      sku: string;
      title: string;
      rawWeight: string;
      weightOz: number | null;
      barcode: string;
    }[]
  >();
  for (const row of rows.filter((r) => r.number > header.number)) {
    const field = (name: string) => string(row.fields.get(columnFor(name)));
    const sku = field("PART NUMBER"),
      title = field("ITEM DESCRIPTION");
    if (!sku || !title) continue;
    const record = {
      row: row.number,
      sku,
      title,
      rawWeight: field("WEIGHT (OZ)"),
      weightOz: parseWeight(field("WEIGHT (OZ)")),
      barcode: field("PART NUMBER BARCODE"),
    };
    const group = groups.get(sku.toLowerCase()) || [];
    group.push(record);
    groups.set(sku.toLowerCase(), group);
  }
  const products = [...groups.values()].map((records) => {
    const last = records.at(-1)!;
    const weights = [
      ...new Set(
        records.map((r) => r.weightOz).filter((n): n is number => n !== null),
      ),
    ];
    const hasInvalid = records.some((r) => r.rawWeight && r.weightOz === null);
    const conflict = weights.length > 1 || hasInvalid;
    const p = makeProduct(last.sku, last.title, {
      workbook: path.basename(filename),
      sheet: "Matched Parts",
      rows: records,
    });
    p.barcode = records.find((r) => r.barcode)?.barcode || "";
    p.aliases = [...new Set(records.map((r) => r.barcode).filter(Boolean))];
    p.unitWeightOz = !conflict && weights.length === 1 ? weights[0] : null;
    p.weightStatus = conflict
      ? "conflict"
      : p.unitWeightOz
        ? "imported"
        : "missing";
    p.weightNote = conflict
      ? "Source rows have conflicting or unreadable weights. Measure the part before counting."
      : p.unitWeightOz
        ? "Imported from workbook; verify against a physical sample."
        : "No usable weight in workbook.";
    return p;
  });
  return {
    products,
    summary: {
      type: "weight_workbook",
      sourceFile: path.basename(filename),
      rows: [...groups.values()].flat().length,
      items: products.length,
      conflicts: products.filter((p) => p.weightStatus === "conflict").length,
      missing: products.filter((p) => p.weightStatus === "missing").length,
      barcodes: products.filter((p) => p.barcode).length,
    },
  };
}
export function legacyProducts(rows: any[], filename: string) {
  const groups = new Map<string, Product>();
  for (const row of rows) {
    const data = json(row.source_data),
      specs = json(row.specs);
    const variants = Array.isArray(json(row.variants))
      ? json(row.variants)
      : [];
    const sourceVariants = data.shopifyProduct?.variants;
    const actual = variants.length
      ? variants
      : Array.isArray(sourceVariants) && sourceVariants.length
        ? sourceVariants
        : [{ sku: row.sku, barcode: specs.barcode || data.partBarcode }];
    for (const variant of actual) {
      const sku =
        string(variant.sku || (actual.length === 1 ? row.sku : "")) ||
        `SHOPIFY-${variant.id || row.shopify_id || row.id}`;
      const title =
        string(row.title) +
        (actual.length > 1 && variant.title && variant.title !== "Default Title"
          ? ` — ${variant.title}`
          : "");
      const p = makeProduct(sku, title, {
        legacyProductId: row.id,
        legacyProductIds: [row.id],
        shopifyProductId: row.shopify_id,
        variantId: variant.id || null,
        sourceFile: path.basename(filename),
        sourceUpdatedAt: row.updated_at,
        legacySourceType: row.source_type,
      });
      p.barcode = string(variant.barcode || specs.barcode || data.partBarcode);
      p.aliases = [p.barcode, string(variant.id), string(row.handle)].filter(
        Boolean,
      );
      p.category = row.product_type || categoryFor(title);
      // Never turn a Shopify shipping weight into a measured component weight.
      const measured = parseWeight(
        variant.unitWeightOz ?? data.unitWeightOz ?? specs.unitWeightOz,
      );
      const conflict = Boolean(data.weightConflict || specs.weightConflict);
      p.unitWeightOz = conflict ? null : measured;
      p.weightStatus = conflict
        ? "conflict"
        : measured
          ? "imported"
          : "missing";
      if (data.weightRows) p.source.weightRows = data.weightRows;
      if (data.shopifyInventory)
        p.source.shopifyInventory = data.shopifyInventory;
      const previous = groups.get(sku.toLowerCase());
      if (previous) {
        previous.source.legacyProductIds = [
          ...new Set([
            ...(previous.source.legacyProductIds as string[]),
            row.id,
          ]),
        ];
        previous.aliases = [
          ...new Set(
            [...previous.aliases, ...p.aliases, p.barcode].filter(Boolean),
          ),
        ];
        if (
          p.weightStatus === "conflict" ||
          previous.weightStatus === "conflict" ||
          (p.unitWeightOz &&
            previous.unitWeightOz &&
            p.unitWeightOz !== previous.unitWeightOz)
        ) {
          previous.unitWeightOz = null;
          previous.weightStatus = "conflict";
        } else if (!previous.unitWeightOz && p.unitWeightOz) {
          previous.unitWeightOz = p.unitWeightOz;
          previous.weightStatus = p.weightStatus;
        }
      } else groups.set(sku.toLowerCase(), p);
    }
  }
  return [...groups.values()];
}

export async function readLegacyTransfer(filename: string) {
  const text = await readFile(filename, "utf8");
  if (Buffer.byteLength(text) > 20 * 1024 * 1024)
    throw new Error("Inventory transfer exceeds the 20 MB limit.");
  const record = z.object({ company_id: z.string().optional() }).passthrough();
  const transfer = z
    .object({
      formatVersion: z.literal(1),
      exportedAt: z.string().datetime(),
      sourceSnapshot: z.string().min(1),
      companyId: z.string().min(1),
      products: z
        .array(
          record
            .extend({ id: z.string().min(1), title: z.string().min(1) })
            .passthrough(),
        )
        .max(100000),
      bins: z.array(record).max(100000),
      counts: z.array(record).max(1000000),
    })
    .strict()
    .parse(JSON.parse(text.replace(/^\uFEFF/, "")));
  if (
    [...transfer.products, ...transfer.bins, ...transfer.counts].some(
      (r) => r.company_id && r.company_id !== transfer.companyId,
    )
  )
    throw new Error(
      "Transfer contains a different company's records. Request a scoped inventory export.",
    );
  if (
    new Set(transfer.products.map((p) => p.id)).size !==
    transfer.products.length
  )
    throw new Error("Transfer contains duplicate product IDs.");
  const products = legacyProducts(transfer.products, filename);
  return {
    products,
    summary: {
      type: "legacy_transfer",
      sourceFile: path.basename(filename),
      sourceSnapshot: transfer.sourceSnapshot,
      companyId: transfer.companyId,
      exportedAt: transfer.exportedAt,
      sourceProducts: transfer.products.length,
      items: products.length,
      sourceBins: transfer.bins.length,
      sourceCounts: transfer.counts.length,
      note: "Catalog preview only; source bins and counts require separate identity/calibration reconciliation before import.",
    },
  };
}

export function readLegacyCatalog(filename: string) {
  if (existsSync(filename + "-wal") && statSync(filename + "-wal").size > 0)
    throw new Error(
      "Source database has an active WAL. Export a consistent online backup before importing.",
    );
  const legacy = new Database(filename, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    if (legacy.pragma("quick_check", { simple: true }) !== "ok")
      throw new Error("Source database integrity check failed.");
    const table = legacy
      .prepare("SELECT name FROM sqlite_master WHERE name='ibolt_products'")
      .get()
      ? "ibolt_products"
      : "products";
    const rows = legacy
      .prepare(`SELECT * FROM ${table} WHERE company_id=?`)
      .all("ibolt-default-company") as any[];
    const products = legacyProducts(rows, filename);
    const count = (t: string) =>
      legacy.prepare("SELECT name FROM sqlite_master WHERE name=?").get(t)
        ? (
            legacy
              .prepare(`SELECT count(*) AS n FROM ${t} WHERE company_id=?`)
              .get("ibolt-default-company") as any
          ).n
        : 0;
    return {
      products,
      summary: {
        type: "legacy_catalog",
        sourceFile: path.basename(filename),
        sourceProducts: rows.length,
        items: products.length,
        sourceBins: count("inventory_bins"),
        sourceCounts: count("inventory_counts"),
        note: "Catalog only; bins and count history are not imported.",
      },
    };
  } finally {
    legacy.close();
  }
}
