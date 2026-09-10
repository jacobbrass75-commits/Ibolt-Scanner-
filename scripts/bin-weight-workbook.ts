import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import path from "node:path";

export interface WeightSheetRow {
  sheet: string;
  row: number;
  sku: string;
  rawPartWeight: string;
  partWeightOz: number | null;
  bins: { cell: string; number: number; raw: string; weightLb: number }[];
}
const array = (value: any): any[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const richText = (value: any): string =>
  typeof value === "string"
    ? value
    : value?.t !== undefined
      ? richText(value.t)
      : value?.["#text"] !== undefined
        ? String(value["#text"])
        : value?.r
          ? array(value.r).map(richText).join("")
          : "";
const decimal = "(\\d+(?:\\.\\d+)?)";
export function partOunces(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  let result: number;
  if (new RegExp(`^${decimal}\\s*(?:oz\\.?)?$`).test(value))
    result = parseFloat(value);
  else {
    const match = value.match(
      new RegExp(`^${decimal}\\s*lbs?\\.?\\s*(?:${decimal}\\s*oz\\.?)?$`),
    );
    if (!match) throw new Error(`Unrecognized part weight: ${raw}`);
    result = Number(match[1]) * 16 + Number(match[2] || 0);
  }
  if (!Number.isFinite(result) || result <= 0 || result > 1e9)
    throw new Error(`Part weight must be positive ounces: ${raw}`);
  return result;
}
export async function readBinWeightWorkbook(
  bytes: Buffer,
): Promise<WeightSheetRow[]> {
  const zip = await JSZip.loadAsync(bytes);
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: false,
  });
  const xml = async (name: string) => {
    const file = zip.file(name);
    if (!file) throw new Error(`Workbook is missing ${name}`);
    return parser.parse(await file.async("text"));
  };
  const sheets = array((await xml("xl/workbook.xml")).workbook.sheets.sheet);
  const rels = array(
    (await xml("xl/_rels/workbook.xml.rels")).Relationships.Relationship,
  );
  const shared = zip.file("xl/sharedStrings.xml")
    ? array((await xml("xl/sharedStrings.xml")).sst.si).map(richText)
    : [];
  const result: WeightSheetRow[] = [];
  for (const sheet of sheets) {
    const target = rels.find(
      (r) => r["@_Id"] === sheet["@_r:id"] && !r["@_TargetMode"],
    )?.["@_Target"];
    if (!target) throw new Error("Worksheet relationship missing or external.");
    const sheetPath = target.startsWith("/")
      ? target.slice(1)
      : path.posix.normalize("xl/" + target);
    if (!sheetPath.startsWith("xl/"))
      throw new Error("Invalid worksheet path.");
    const rows = array((await xml(sheetPath)).worksheet.sheetData?.row).map(
      (row) => {
        const cells = new Map<
          string,
          { raw: string; formula: boolean; type: string }
        >();
        for (const c of array(row.c)) {
          const raw =
            c["@_t"] === "s"
              ? shared[Number(c.v)]
              : c["@_t"] === "inlineStr"
                ? richText(c.is)
                : String(c.v ?? "");
          cells.set(String(c["@_r"]).replace(/\d/g, ""), {
            raw: raw ?? "",
            formula: c.f !== undefined,
            type: c["@_t"] || "n",
          });
        }
        return { number: Number(row["@_r"]), cells };
      },
    );
    const header = rows.find(
      (row) =>
        row.cells.get("A")?.raw.trim() === "Part" &&
        row.cells.get("B")?.raw.trim() === "Part (oz)",
    );
    if (!header) continue;
    const columns = [...header.cells].flatMap(([column, cell]) => {
      const match = cell.raw.trim().match(/^Bin (\d+) \(Lbs\)$/i);
      return match ? [{ column, number: Number(match[1]) }] : [];
    });
    if (
      !columns.length ||
      new Set(columns.map((c) => c.number)).size !== columns.length
    )
      throw new Error("Missing or duplicate bin-weight headers.");
    for (const row of rows.filter((r) => r.number > header.number)) {
      const value = (column: string) => {
        const cell = row.cells.get(column);
        if (
          cell?.formula ||
          (cell && !["s", "inlineStr", "n"].includes(cell.type))
        )
          throw new Error(
            `Use plain measurements, not formulas or errors, at ${sheet["@_name"]}!${column}${row.number}.`,
          );
        return cell?.raw ?? "";
      };
      const sku = value("A").trim(),
        rawPartWeight = value("B");
      const bins: WeightSheetRow["bins"] = [];
      for (const column of columns) {
        const raw = value(column.column);
        if (!raw.trim()) continue;
        if (!/^\d+(?:\.\d+)?$/.test(raw.trim()) || Number(raw) > 1e10)
          throw new Error(
            `Invalid pound measurement at ${sheet["@_name"]}!${column.column}${row.number}.`,
          );
        bins.push({
          cell: column.column + row.number,
          number: column.number,
          raw,
          weightLb: Number(raw),
        });
      }
      if (!sku && !rawPartWeight.trim() && !bins.length) continue;
      if (!sku || !Number.isSafeInteger(row.number) || row.number <= 0)
        throw new Error(
          `Missing part number or invalid source row ${row.number}.`,
        );
      result.push({
        sheet: sheet["@_name"],
        row: row.number,
        sku,
        rawPartWeight,
        partWeightOz: partOunces(rawPartWeight),
        bins,
      });
    }
  }
  if (!result.length)
    throw new Error(
      "No rows found under Part / Part (oz) / Bin N (Lbs) headers.",
    );
  return result;
}
