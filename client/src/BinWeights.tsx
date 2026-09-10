import React, { useEffect, useRef, useState } from "react";
import type { Bin, BinWeight, Product } from "../../shared/types";

type Request = <T>(url: string, method?: string, data?: unknown) => Promise<T>;
const number = (value: number | null | undefined) =>
  value == null
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
export function BinWeights({
  products,
  canEdit,
  api,
  created,
}: {
  products: Product[];
  canEdit: boolean;
  api: Request;
  created: (bin: Bin) => Promise<void>;
}) {
  const [rows, setRows] = useState<BinWeight[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<BinWeight | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  async function reload() {
    setRows(await api<BinWeight[]>("/bin-weights"));
  }
  useEffect(() => {
    reload()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (selected)
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected?.id]);
  const byId = new Map(products.map((p) => [p.id, p]));
  const visible = rows.filter(
    (row) =>
      [
        row.sku,
        byId.get(row.productId || "")?.title,
        row.sourceFile,
        row.sourceCell,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "match" && !row.productId) ||
        (filter === "setup" && !row.binId) ||
        (filter === "ready" && !!row.binId)),
  );
  const sourceRows = new Set(
    rows.map((row) => `${row.sourceHash}:${row.sheet}:${row.sourceRow}`),
  ).size;
  return (
    <>
      <section className="panel weight-sheet-intro">
        <h2>
          {rows.length} bin measurements{" "}
          <span className="hint">from {sourceRows} worksheet rows</span>
        </h2>
        <p>
          Original bin weights are shown in pounds. Part weights are in ounces.
          Repeated part numbers remain separate worksheet entries.
        </p>
        <p className="weight-sheet-callout">
          The spreadsheet does not specify empty-container weights or whether
          they were subtracted. Confirm the part and empty-bin weights to set up
          each bin, then weigh it again in Scan &amp; count to save a current
          quantity.
        </p>
        <p className="hint">
          {rows.filter((r) => !r.productId).length} measurements need a catalog
          match · {rows.filter((r) => !!r.binId).length} bins set up
        </p>
      </section>
      {selected && (
        <div ref={formRef}>
          <SetUpWeight
            key={selected.id}
            row={selected}
            products={products}
            api={api}
            close={() => setSelected(null)}
            saved={async (bin) => {
              await reload();
              setSelected(null);
              await created(bin);
            }}
          />
        </div>
      )}
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <input
              aria-label="Search bin measurements"
              placeholder="Scan or search a part number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter bin measurements"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All measurements</option>
            <option value="match">Needs catalog match</option>
            <option value="setup">Needs bin setup</option>
            <option value="ready">Bin ready</option>
          </select>
          <span className="hint">{visible.length} shown</span>
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Part / catalog match</th>
                <th>Worksheet bin</th>
                <th>Bin weight</th>
                <th>Sheet part weight</th>
                <th>Setup</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const product = byId.get(row.productId || "");
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.sku}</strong>
                      <small>
                        {product?.title ||
                          (row.candidateProductIds.length > 1
                            ? "Multiple catalog matches — choose the correct item"
                            : "Part number not found in catalog")}
                      </small>
                    </td>
                    <td>
                      <strong>Bin {row.binNumber}</strong>
                      <small>
                        Row {row.sourceRow} · {row.sourceCell}
                      </small>
                      <details>
                        <summary>Source</summary>
                        <small>
                          {row.sourceFile}
                          <br />
                          {row.sheet}!{row.sourceCell}
                          <br />
                          Part entry: {row.rawPartWeight || "blank"}
                          <br />
                          Bin entry: {row.rawBinWeight} lb
                        </small>
                      </details>
                    </td>
                    <td className="numeric">
                      <strong>{number(row.binWeightLb)} lb</strong>
                    </td>
                    <td className="numeric">
                      {row.partWeightOz === null
                        ? "Not supplied"
                        : `${number(row.partWeightOz)} oz`}
                      <small>
                        Catalog:{" "}
                        {product?.unitWeightOz == null
                          ? "needs weight"
                          : `${number(product.unitWeightOz)} oz${product.weightStatus === "verified" ? " · measured" : ""}`}
                      </small>
                    </td>
                    <td>
                      {row.binId ? (
                        <span className="badge verified">Bin ready</span>
                      ) : (
                        <>
                          <button
                            disabled={!canEdit}
                            onClick={() => setSelected(row)}
                          >
                            {product ? "Set up bin" : "Match & set up"}
                          </button>
                          <small>
                            {product
                              ? "Empty-bin weight required"
                              : "Confirm the catalog item"}
                          </small>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <div className="empty">
            <h3>
              {loading
                ? "Loading measurements…"
                : rows.length
                  ? "No matching measurements."
                  : "No bin-weight sheets imported yet."}
            </h3>
          </div>
        )}
      </section>
    </>
  );
}

function SetUpWeight({
  row,
  products,
  api,
  close,
  saved,
}: {
  row: BinWeight;
  products: Product[];
  api: Request;
  close: () => void;
  saved: (bin: Bin) => Promise<void>;
}) {
  const initial = products.find((p) => p.id === row.productId);
  const [productId, setProductId] = useState(row.productId || ""),
    [label, setLabel] = useState(
      `${row.sku} — Bin ${row.binNumber} · row ${row.sourceRow}`,
    ),
    [weight, setWeight] = useState(
      String(initial?.unitWeightOz ?? row.partWeightOz ?? ""),
    ),
    [tare, setTare] = useState(""),
    [location, setLocation] = useState(""),
    [notes, setNotes] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="panel weight-sheet-intro">
      <h2>
        Set up {row.sku} · Bin {row.binNumber}
      </h2>
      <p>
        Recorded weight: <strong>{number(row.binWeightLb)} lb</strong> (
        {row.sheet}!{row.sourceCell}). The empty-bin field is intentionally
        blank until measured.
      </p>
      <form
        onChange={() => setConfirmed(false)}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !confirmed) return;
          setBusy(true);
          setError("");
          try {
            const bin = await api<Bin>(`/bin-weights/${row.id}/bin`, "POST", {
              productId,
              binLabel: label,
              unitWeightOz: Number(weight),
              emptyBinWeightOz: Number(tare),
              location,
              notes,
              expectedUpdatedAt: row.updatedAt,
              weightsConfirmed: true,
            });
            await saved(bin);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>Catalog item</span>
          <select
            required
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              const p = products.find((p) => p.id === e.target.value);
              setWeight(String(p?.unitWeightOz ?? row.partWeightOz ?? ""));
            }}
          >
            <option value="">Choose the matching item…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} · {p.title}
                {products.filter((other) => other.sku === p.sku).length > 1
                  ? ` · ${p.id}`
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Bin label</span>
          <input
            required
            maxLength={160}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <div className="two-fields">
          <label className="field">
            <span>One part weight (oz)</span>
            <input
              aria-label="Imported bin part weight"
              type="number"
              min="0.000001"
              step="any"
              required
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
            <small>Check the part weight against a measured sample.</small>
          </label>
          <label className="field">
            <span>Empty-bin weight (oz)</span>
            <input
              aria-label="Imported empty-bin weight"
              type="number"
              min="0"
              step="any"
              required
              value={tare}
              onChange={(e) => setTare(e.target.value)}
            />
            <small>
              Weigh the empty container. Convert pounds to ounces by multiplying
              by 16.
            </small>
          </label>
        </div>
        <div className="two-fields">
          <label className="field">
            <span>Location</span>
            <input
              maxLength={2000}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Setup notes</span>
            <input
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => {
              e.stopPropagation();
              setConfirmed(e.target.checked);
            }}
          />
          I checked the catalog match and confirmed the part and empty-bin
          weights.
        </label>
        <p className="hint">
          This creates a bin and label. The original worksheet measurement stays
          available here. Save a fresh physical count from Scan &amp; count.
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              busy || !confirmed || !productId || !weight || tare === ""
            }
          >
            Create bin
          </button>
        </div>
      </form>
    </section>
  );
}
