// Inventory screens live at the root, with optional view or bin query parameters.
export function inventoryReturnTo(value: unknown): string {
  return typeof value === "string" &&
    /^\/(?:\?|#|$)/.test(value) &&
    !/[\\\u0000-\u0020]/.test(value)
    ? value
    : "/";
}
