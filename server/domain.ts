import type { Count } from "../shared/types";
import { InventoryError } from "./errors";
export function normalizeScan(raw: string): string {
  let code = raw
    .trim()
    .replace(/^[\x02\x03]+|[\x02\x03]+$/g, "")
    .replace(/^\][A-Za-z][0-9]/, "");
  if (code.startsWith("IBOLTINV:")) {
    code = code.slice(9).trim();
    if (code.startsWith("{")) {
      try {
        const p = JSON.parse(code);
        const candidate = p?.qrCode || p?.code || p?.bin || p?.binId;
        if (typeof candidate === "string") code = candidate;
      } catch {}
    }
  }
  try {
    const url = new URL(code, "http://inventory.local");
    for (const key of [
      "bin",
      "code",
      "qr",
      "inventoryBin",
      "inventory_bin",
      "sku",
      "barcode",
      "variant",
      "product",
    ]) {
      const value = url.searchParams.get(key);
      if (value) return value.trim();
    }
    if (/^https?:/.test(code) && url.pathname.includes("/products/"))
      return decodeURIComponent(
        url.pathname.split("/products/")[1].split("/")[0],
      );
  } catch {}
  return code.trim();
}
export function calculate(
  total: number,
  unit: "oz" | "lb" | "g" | "kg",
  tare: number,
  part: number,
  rounding: Count["roundingMode"],
) {
  if (
    ![total, tare, part].every(Number.isFinite) ||
    total < 0 ||
    tare < 0 ||
    part <= 0
  )
    throw new InventoryError(
      "Enter valid weights. Part weight must be greater than zero.",
    );
  const factors = {
    oz: 1,
    lb: 16,
    g: 1 / 28.349523125,
    kg: 1000 / 28.349523125,
  };
  const totalWeightOz = total * factors[unit];
  const difference = totalWeightOz - tare;
  if (difference < -1e-9)
    throw new InventoryError(
      "Total weight is below the empty bin weight. Check the scale or tare.",
    );
  const netWeightOz = Math.max(0, difference);
  const rawQuantity = netWeightOz / part;
  const nearestInteger = Math.round(rawQuantity);
  const stable =
    Math.abs(rawQuantity - nearestInteger) < 1e-9
      ? nearestInteger
      : rawQuantity;
  const quantity =
    rounding === "floor"
      ? Math.floor(stable)
      : rounding === "ceil"
        ? Math.ceil(stable)
        : Math.round(stable);
  if (!Number.isSafeInteger(quantity))
    throw new InventoryError(
      "Calculated count is too large. Check the units and part weight.",
    );
  return {
    totalWeightOz,
    emptyBinWeightOz: tare,
    unitWeightOz: part,
    netWeightOz,
    rawQuantity,
    quantity,
    roundingMode: rounding,
  };
}
