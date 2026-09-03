export type WeightStatus = "missing" | "imported" | "conflict" | "verified";
export interface Product {
  id: string;
  sku: string;
  title: string;
  barcode: string;
  aliases: string[];
  category: string;
  unitWeightOz: number | null;
  weightStatus: WeightStatus;
  weightNote: string;
  source: Record<string, unknown>;
  updatedAt: string;
}
export interface Bin {
  id: string;
  productId: string;
  sku: string;
  productTitle: string;
  binLabel: string;
  qrCode: string;
  unitWeightOz: number;
  emptyBinWeightOz: number;
  location: string;
  notes: string;
  status: "active" | "archived";
  lastQuantity: number | null;
  lastCountAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Count {
  id: string;
  requestId: string;
  binId: string;
  sku: string;
  binLabel: string;
  productTitle: string;
  totalWeightOz: number;
  emptyBinWeightOz: number;
  unitWeightOz: number;
  netWeightOz: number;
  rawQuantity: number;
  quantity: number;
  roundingMode: "nearest" | "floor" | "ceil";
  countedBy: string;
  notes: string;
  createdAt: string;
}
export interface Calculation {
  bin: Bin;
  totalWeightOz: number;
  emptyBinWeightOz: number;
  unitWeightOz: number;
  netWeightOz: number;
  rawQuantity: number;
  quantity: number;
  roundingMode: Count["roundingMode"];
  count: Count | null;
}
export interface Lookup {
  code: string;
  bins: Bin[];
  products: Product[];
}
