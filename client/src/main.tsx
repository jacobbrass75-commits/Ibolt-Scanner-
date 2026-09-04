import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ClerkProvider,
  Show,
  SignIn,
  SignUp,
  SignOutButton,
  UserButton,
  Waitlist,
} from "@clerk/react";
import {
  Boxes,
  ScanLine,
  Scale,
  ClipboardList,
  Package,
  ArrowRight,
  Plus,
  Search,
  Camera,
  X,
  Download,
  Printer,
  Check,
  Settings2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import QRCode from "qrcode";
import type {
  Bin,
  Product,
  Count,
  Calculation,
  Lookup,
} from "../../shared/types";
import "./style.css";

let clerkPublishableKey = "";
let clerkProxyUrl = "";
let clerkEnabled = false;

async function api<T>(url: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch("/api" + url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!response.ok) {
    if (response.status === 401)
      window.location.assign(
        (clerkEnabled ? "/sign-in?returnTo=" : "/login?returnTo=") +
          encodeURIComponent(window.location.pathname + window.location.search),
      );
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Request failed (${response.status}).`);
  }
  return response.json();
}
const number = (v: number | null | undefined, digits = 4) =>
  v == null
    ? "—"
    : v.toLocaleString(undefined, { maximumFractionDigits: digits });
const date = (v: string | null) =>
  v ? new Date(v).toLocaleString() : "Not counted yet";
const catalogIdentity = (p: Product) =>
  p.source.variantId
    ? `Shopify variant ${String(p.source.variantId)}`
    : p.source.workbook
      ? "Workbook part"
      : "Catalog part";
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Badge({ product }: { product: Product }) {
  return (
    <span className={"badge " + product.weightStatus}>
      {
        {
          missing: "Needs weight",
          imported: "From workbook",
          conflict: "Review weight",
          verified: "Measured",
        }[product.weightStatus]
      }
    </span>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={close}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon" aria-label="Close dialog" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function CameraScanner({
  found,
  close,
  error,
}: {
  found: (code: string) => void;
  close: () => void;
  error: (message: string) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let cancelled = false;
    let controls: { stop: () => void } | undefined;
    const video = ref.current!;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error(
            "Camera scanning needs HTTPS or localhost. A USB scanner works in the scan field.",
          );
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        controls = await new BrowserMultiFormatReader().decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          video,
          (result, _err, active) => {
            if (result && !cancelled) {
              cancelled = true;
              active.stop();
              found(result.getText());
              close();
            }
          },
        );
        if (cancelled) controls.stop();
      } catch (e: any) {
        if (!cancelled) {
          error(
            e.name === "NotAllowedError"
              ? "Camera permission was denied. Allow camera access or use a USB scanner."
              : e.message,
          );
          close();
        }
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
      if (video.srcObject instanceof MediaStream)
        video.srcObject.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }, []);
  return (
    <div className="camera">
      <video ref={ref} muted playsInline autoPlay />
      <button onClick={close}>
        <X size={16} />
        Stop camera
      </button>
    </div>
  );
}
function App() {
  const [tab, setTab] = useState("count");
  const [products, setProducts] = useState<Product[]>([]),
    [bins, setBins] = useState<Bin[]>([]),
    [counts, setCounts] = useState<Count[]>([]);
  const [status, setStatus] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [scan, setScan] = useState(""),
    [lookup, setLookup] = useState<Lookup | null>(null),
    [selected, setSelected] = useState<Bin | null>(null);
  const [camera, setCamera] = useState(false),
    [diagnostic, setDiagnostic] = useState(false),
    [scans, setScans] = useState<
      { code: string; suffix: string; at: string; matches: number }[]
    >([]);
  const scanRef = useRef<HTMLInputElement>(null),
    weightRef = useRef<HTMLInputElement>(null);
  const [weight, setWeight] = useState(""),
    [unit, setUnit] = useState<"oz" | "lb" | "g" | "kg">("oz"),
    [rounding, setRounding] = useState<Count["roundingMode"]>("nearest");
  const [operator, setOperator] = useState(
      () => localStorage.getItem("inventory-operator") || "",
    ),
    [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<Calculation | null>(null),
    [requestId, setRequestId] = useState("");
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const [editProduct, setEditProduct] = useState<Product | null>(null),
    [binEditor, setBinEditor] = useState<{
      product: Product;
      bin?: Bin;
    } | null>(null),
    [qr, setQr] = useState<Bin | null>(null);
  const [archive, setArchive] = useState<Bin | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const canEdit = status?.identity?.role !== "viewer" && !!status;
  const isAdmin = status?.identity?.role === "admin";
  async function reload() {
    const [p, b, c, s] = await Promise.all([
      api<Product[]>("/products"),
      api<Bin[]>("/bins"),
      api<{ items: Count[]; nextCursor: string | null; total: number }>(
        "/counts",
      ),
      api("/status"),
    ]);
    setProducts(p);
    setBins(b);
    setCounts(c.items);
    setNextCursor(c.nextCursor);
    setStatus(s);
    setLoading(false);
    setConnected(true);
    setSelected((old) => (old ? b.find((x) => x.id === old.id) || null : null));
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e: any) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    reload().catch((e) => {
      setError(e.message);
      setLoading(false);
    });
    const interval = window.setInterval(() => {
      api("/health")
        .then(() => setConnected(true))
        .catch(() => setConnected(false));
    }, 30000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    localStorage.setItem("inventory-operator", operator);
  }, [operator]);
  useEffect(() => {
    setPreview(null);
    setRequestId("");
  }, [weight, unit, rounding, operator, notes, selected?.id]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (tab === "count") scanRef.current?.focus();
  }, [tab, diagnostic]);
  useEffect(() => {
    if (
      !busy &&
      !loading &&
      tab === "count" &&
      !selected &&
      !binEditor &&
      !qr &&
      !editProduct
    )
      scanRef.current?.focus();
  }, [
    busy,
    loading,
    tab,
    diagnostic,
    selected?.id,
    Boolean(binEditor),
    Boolean(qr),
    Boolean(editProduct),
  ]);
  const initialized = useRef(false);
  useEffect(() => {
    if (loading || initialized.current) return;
    initialized.current = true;
    const query = new URLSearchParams(location.search);
    const code = query.get("bin") || query.get("code") || query.get("qr");
    if (code) {
      setScan(code);
      void handleScan(code, "URL");
    }
  }, [loading]);
  function selectBin(bin: Bin) {
    setSelected(bin);
    setLookup(null);
    setWeight("");
    setPreview(null);
    setTab("count");
    setTimeout(() => weightRef.current?.focus(), 50);
  }
  async function handleScan(raw = scan, suffix = "Button") {
    if (!raw.trim()) return;
    await run(async () => {
      setPreview(null);
      setSelected(null);
      setLookup(null);
      setWeight("");
      const result = await api<Lookup>(
        "/lookup?code=" + encodeURIComponent(raw),
      );
      setScans((list) =>
        [
          {
            code: raw,
            suffix,
            at: new Date().toLocaleTimeString(),
            matches: result.bins.length || result.products.length,
          },
          ...list,
        ].slice(0, 10),
      );
      if (diagnostic) {
        setNotice(
          result.bins.length || result.products.length
            ? "Scanner input received and matched the catalog."
            : "Scanner input received. This exact code is not in the catalog yet.",
        );
      } else if (result.bins.length === 1 && result.products.length <= 1)
        selectBin(result.bins[0]);
      else if (
        result.products.length === 1 &&
        result.bins.length === 0 &&
        canEdit
      ) {
        setBinEditor({ product: result.products[0] });
      } else if (result.products.length || result.bins.length)
        setLookup(result);
      else
        setError(
          `No exact match for “${result.code}”. Search Catalog & weights to find the item and assign its printed barcode.`,
        );
      setScan("");
      if (diagnostic) scanRef.current?.focus();
    });
  }
  async function calculate(save: boolean) {
    if (!selected) return;
    await run(async () => {
      if (!weight.trim()) throw new Error("Enter the total scale weight.");
      const result = await api<Calculation>("/calculate", "POST", {
        binId: selected.id,
        totalWeight: Number(weight),
        weightUnit: unit,
        roundingMode: rounding,
        countedBy: operator,
        notes,
        save,
        ...(save
          ? { requestId, expectedBinUpdatedAt: preview?.bin.updatedAt }
          : {}),
      });
      setPreview(result);
      if (save) {
        setSelected(result.bin);
        setNotice(`Saved ${result.quantity} units for ${result.bin.binLabel}.`);
        await reload();
      } else setRequestId(crypto.randomUUID());
    });
  }
  const visibleProducts = useMemo(
    () =>
      products.filter(
        (p) =>
          (!search ||
            [p.sku, p.title, p.barcode, p.category, ...p.aliases]
              .join(" ")
              .toLowerCase()
              .includes(search.toLowerCase())) &&
          (filter === "all" || filter === "needs"
            ? filter !== "needs" ||
              ["missing", "conflict"].includes(p.weightStatus)
            : p.weightStatus === filter),
      ),
    [products, search, filter],
  );
  const sharedSkus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products)
      counts.set(
        p.sku.toLowerCase(),
        (counts.get(p.sku.toLowerCase()) || 0) + 1,
      );
    return new Set([...counts].filter(([, n]) => n > 1).map(([sku]) => sku));
  }, [products]);
  const visibleBins = bins.filter((b) =>
    [b.sku, b.productTitle, b.binLabel, b.location, b.qrCode]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const menu = [
    { id: "count", icon: ScanLine, label: "Scan & count" },
    { id: "catalog", icon: Scale, label: "Catalog & weights" },
    { id: "bins", icon: Boxes, label: "Bins & labels" },
    { id: "history", icon: ClipboardList, label: "Count history" },
  ];
  const changeTab = (next: string) => {
    setTab(next);
    setSearch("");
    setCamera(false);
  };
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Boxes size={25} />
          </div>
          <div>
            <strong>
              iBolt<span>Inventory</span>
            </strong>
            <small>WAREHOUSE OPERATIONS</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {menu.map((m) => (
            <button
              key={m.id}
              className={tab === m.id ? "active" : ""}
              onClick={() => changeTab(m.id)}
            >
              <m.icon size={19} />
              {m.label}
              {tab === m.id && <ChevronRight size={16} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="dot" />
          {status?.publicOrigin
            ? "Hosted inventory workspace"
            : "Local inventory workspace"}
          <p>Physical counts stay in this database.</p>
          {status?.identity?.authenticated && (
            <>
              <p>
                {status.identity.displayName} · {status.identity.role}
              </p>
              {clerkEnabled ? (
                <div className="clerk-account">
                  <UserButton />
                  <SignOutButton redirectUrl="/sign-in">
                    <button type="button">Sign out</button>
                  </SignOutButton>
                </div>
              ) : (
                <form action="/logout" method="post">
                  <button type="submit">Sign out</button>
                </form>
              )}
            </>
          )}
          <small>Shopify quantities are unchanged.</small>
        </div>
        <button
          className="backup"
          disabled={busy || !isAdmin}
          onClick={() =>
            run(async () => {
              const response = await fetch("/api/backup", { method: "POST" });
              if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error || "Backup failed.");
              }
              const url = URL.createObjectURL(await response.blob());
              const a = document.createElement("a");
              a.href = url;
              a.download = `inventory-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 10000);
              setNotice("Backup created and downloaded.");
            })
          }
        >
          <Download size={17} />
          Back up inventory
        </button>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            Operations <ChevronRight size={14} />
            <b>{menu.find((m) => m.id === tab)?.label}</b>
          </span>
          <span className="connection">
            <span className="dot" />
            {loading
              ? "Connecting…"
              : connected
                ? "Database connected"
                : "Connection unavailable"}
            {!connected && !loading && (
              <button onClick={() => run(reload)} disabled={busy}>
                Reconnect
              </button>
            )}
          </span>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">iBOLT INVENTORY</div>
              <h1>
                {tab === "count"
                  ? "Ready for the next count."
                  : menu.find((m) => m.id === tab)?.label}
              </h1>
              <p>
                {tab === "count"
                  ? "Scan a label, weigh the bin, and record what’s on the shelf."
                  : tab === "catalog"
                    ? "Find every catalog item and prepare its measured unit weight."
                    : tab === "bins"
                      ? "Keep locations, tare weights, and bin labels together."
                      : "A permanent record of your physical inventory counts."}
              </p>
            </div>
            {tab === "count" && (
              <button
                className={diagnostic ? "primary" : ""}
                onClick={() => {
                  setDiagnostic(!diagnostic);
                  setSelected(null);
                  setPreview(null);
                  setLookup(null);
                }}
              >
                <Settings2 size={17} />
                {diagnostic ? "Exit scanner test" : "Test scanner"}
              </button>
            )}
          </div>
          {error && (
            <div className="message error" role="alert">
              <AlertCircle size={19} />
              <span>{error}</span>
              <button
                aria-label="Dismiss error"
                className="icon"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              <CheckCircle2 size={19} />
              {notice}
            </div>
          )}
          <div className="stats">
            <div>
              <span>Catalog items</span>
              <strong>{loading ? "—" : products.length}</strong>
              <small>Parts and product variants</small>
            </div>
            <div>
              <span>Measured weights</span>
              <strong>
                {status?.verified ?? "—"}
                <small> / {products.length}</small>
              </strong>
              <small>Confirmed in this workspace</small>
            </div>
            <div>
              <span>Active bins</span>
              <strong>{bins.length}</strong>
              <small>Ready to scan</small>
            </div>
            <div>
              <span>Saved counts</span>
              <strong>{counts.length}</strong>
              <small>Auditable scale readings</small>
            </div>
          </div>
          {loading ? (
            <section className="panel empty">Loading your inventory…</section>
          ) : tab === "count" ? (
            <>
              <div className="count-layout">
                <section className="panel scan-panel">
                  <div className="section-head">
                    <div className="section-icon">
                      <ScanLine size={23} />
                    </div>
                    <div>
                      <h2>
                        {diagnostic
                          ? "Scanner test bench"
                          : "Scan a bin or product"}
                      </h2>
                      <p>
                        {diagnostic
                          ? "Check the exact text and Enter or Tab suffix from your scanner."
                          : "USB scanner, bin QR code, SKU, or product barcode."}
                      </p>
                    </div>
                  </div>
                  <form
                    className="scan-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleScan(scan, "Enter");
                    }}
                  >
                    <div className="scan-input">
                      <ScanLine size={23} />
                      <input
                        aria-label="Scan code"
                        ref={scanRef}
                        value={scan}
                        onChange={(e) => setScan(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Tab" && scan.trim()) {
                            e.preventDefault();
                            void handleScan(scan, "Tab");
                          }
                        }}
                        autoComplete="off"
                        placeholder="Scan or enter a code…"
                        disabled={busy}
                      />
                    </div>
                    <button className="primary" disabled={busy || !scan.trim()}>
                      Look up
                      <ArrowRight size={18} />
                    </button>
                  </form>
                  <div className="scan-hint">
                    <span>
                      <span className="dot" />
                      Ready for a USB keyboard scanner
                    </span>
                    <button
                      className="text-button"
                      onClick={() => setCamera(!camera)}
                    >
                      <Camera size={17} />
                      {camera ? "Close camera" : "Use camera"}
                    </button>
                  </div>
                  {camera && (
                    <CameraScanner
                      found={(code) => {
                        setScan(code);
                        void handleScan(code, "Camera");
                      }}
                      close={() => setCamera(false)}
                      error={setError}
                    />
                  )}
                  {diagnostic ? (
                    <div className="diagnostics">
                      <p>
                        Scan any label. This mode does not create bins or save
                        counts. For a Code 128 part label, the result should be
                        the printed part number.
                      </p>
                      {scans.length ? (
                        scans.map((s, i) => (
                          <div className="diagnostic-row" key={i}>
                            <code>{JSON.stringify(s.code)}</code>
                            <span>
                              {s.suffix} · {s.code.length} characters ·{" "}
                              {s.matches} matches · {s.at}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="empty small">
                          Waiting for your first scan.
                        </div>
                      )}
                    </div>
                  ) : lookup ? (
                    <div className="matches">
                      <h3>
                        Choose the matching{" "}
                        {lookup.bins.length ? "bin" : "item"}
                      </h3>
                      <p>
                        This code has multiple matches. Select the correct one
                        before counting.
                      </p>
                      {lookup.bins.map((b) => (
                        <button key={b.id} onClick={() => selectBin(b)}>
                          <Boxes size={18} />
                          <span>
                            {b.binLabel}
                            <small>
                              {b.sku} · {b.location || "No location"}
                            </small>
                          </span>
                          <ArrowRight size={16} />
                        </button>
                      ))}
                      {lookup.products.map((p) => (
                        <button
                          key={p.id}
                          disabled={!canEdit}
                          onClick={() => {
                            setBinEditor({ product: p });
                            setLookup(null);
                          }}
                        >
                          <Package size={18} />
                          <span>
                            {p.sku}
                            <small>{p.title}</small>
                            <small>{catalogIdentity(p)}</small>
                          </span>
                          <Plus size={16} />
                        </button>
                      ))}
                    </div>
                  ) : selected ? (
                    <div className="selected-bin">
                      <div className="selected-heading">
                        <span className="badge verified">BIN LOADED</span>
                        <button
                          className="text-button"
                          onClick={() => setQr(selected)}
                        >
                          View label
                        </button>
                      </div>
                      <h3>{selected.binLabel}</h3>
                      <p>{selected.productTitle}</p>
                      <div className="bin-facts">
                        <span>
                          SKU<strong>{selected.sku}</strong>
                        </span>
                        <span>
                          Part weight
                          <strong>{number(selected.unitWeightOz)} oz</strong>
                        </span>
                        <span>
                          Empty bin
                          <strong>
                            {number(selected.emptyBinWeightOz)} oz
                          </strong>
                        </span>
                        <span>
                          Location
                          <strong>{selected.location || "Unassigned"}</strong>
                        </span>
                      </div>
                      <div className="selected-footer">
                        <small>
                          Last count:{" "}
                          {selected.lastQuantity === null
                            ? "None"
                            : `${selected.lastQuantity} units`}{" "}
                          · {date(selected.lastCountAt)}
                        </small>
                        <button
                          className="text-button"
                          onClick={() => {
                            const p = products.find(
                              (p) => p.id === selected.productId,
                            );
                            if (p) setBinEditor({ product: p, bin: selected });
                          }}
                          disabled={!canEdit}
                        >
                          Edit bin
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="scan-empty">
                      <div>
                        <Package size={38} />
                      </div>
                      <h3>Your next bin starts here.</h3>
                      <p>
                        Scan a bin label to begin. A product scan opens bin
                        setup when no bin exists yet.
                      </p>
                      <button onClick={() => changeTab("catalog")}>
                        Browse the catalog
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                </section>
                <section className="panel scale-panel">
                  <div className="section-head">
                    <div className="section-icon">
                      <Scale size={22} />
                    </div>
                    <div>
                      <h2>Weigh & count</h2>
                      <p>Use the total weight including the bin.</p>
                    </div>
                  </div>
                  <fieldset disabled={!selected || busy || diagnostic}>
                    <div className="weight-entry">
                      <Field label="Total scale weight">
                        <input
                          ref={weightRef}
                          aria-label="Total scale weight"
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={weight}
                          onChange={(e) => setWeight(e.target.value)}
                          placeholder="0.00"
                        />
                      </Field>
                      <Field label="Unit">
                        <select
                          value={unit}
                          onChange={(e) =>
                            setUnit(e.target.value as typeof unit)
                          }
                        >
                          <option value="oz">oz</option>
                          <option value="lb">lb</option>
                          <option value="g">g</option>
                          <option value="kg">kg</option>
                        </select>
                      </Field>
                    </div>
                    <div className="two-fields">
                      <Field label="Rounding">
                        <select
                          value={rounding}
                          onChange={(e) =>
                            setRounding(e.target.value as typeof rounding)
                          }
                        >
                          <option value="nearest">Nearest whole unit</option>
                          <option value="floor">Round down</option>
                          <option value="ceil">Round up</option>
                        </select>
                      </Field>
                      <Field label="Counted by">
                        <input
                          value={
                            status?.identity?.authenticated
                              ? status.identity.displayName
                              : operator
                          }
                          readOnly={!!status?.identity?.authenticated}
                          onChange={(e) => setOperator(e.target.value)}
                          placeholder="Your name"
                        />
                      </Field>
                    </div>
                    <Field label="Count notes (optional)">
                      <input
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Damaged parts, bin condition…"
                      />
                    </Field>
                    <div
                      className={"quantity " + (preview ? "calculated" : "")}
                    >
                      <span>ESTIMATED QUANTITY</span>
                      <strong>
                        {preview ? number(preview.quantity, 0) : "—"}
                        <small>units</small>
                      </strong>
                      <p>
                        {preview
                          ? `(${number(preview.totalWeightOz)} − ${number(preview.emptyBinWeightOz)}) oz ÷ ${number(preview.unitWeightOz)} oz`
                          : "Total weight − empty bin weight ÷ part weight"}
                      </p>
                      {preview && (
                        <small>
                          Unrounded: {number(preview.rawQuantity)} · Net:{" "}
                          {number(preview.netWeightOz)} oz
                        </small>
                      )}
                    </div>
                    <button
                      className="wide"
                      onClick={() => calculate(false)}
                      disabled={!weight.trim()}
                    >
                      Preview count
                    </button>
                    <button
                      className="primary wide"
                      onClick={() => calculate(true)}
                      disabled={
                        !preview || !!preview.count || !requestId || !canEdit
                      }
                    >
                      <Check size={18} />
                      {preview?.count ? "Count saved" : "Save count"}
                    </button>
                    {preview?.count && (
                      <button
                        className="text-button wide"
                        onClick={() => {
                          setSelected(null);
                          setPreview(null);
                          setWeight("");
                          setNotes("");
                          scanRef.current?.focus();
                        }}
                      >
                        Scan the next bin
                        <ArrowRight size={16} />
                      </button>
                    )}
                  </fieldset>
                </section>
              </div>
              <section className="panel getting-started">
                <div>
                  <span className="step">01</span>
                  <h3>Prepare your parts</h3>
                  <p>
                    Review weights and assign the codes printed on your labels.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => changeTab("catalog")}
                  >
                    Catalog & weights
                    <ArrowRight size={15} />
                  </button>
                </div>
                <div>
                  <span className="step">02</span>
                  <h3>Measure the empty bin</h3>
                  <p>Create a bin with its own measured tare and location.</p>
                  <button
                    className="text-button"
                    onClick={() => changeTab("bins")}
                  >
                    Bins & labels
                    <ArrowRight size={15} />
                  </button>
                </div>
                <div>
                  <span className="step">03</span>
                  <h3>Test a known quantity</h3>
                  <p>
                    Start with 10 hand-counted parts to check scale accuracy.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => {
                      setDiagnostic(true);
                      scanRef.current?.focus();
                    }}
                  >
                    Test the scanner
                    <ArrowRight size={15} />
                  </button>
                </div>
              </section>
            </>
          ) : tab === "catalog" ? (
            <section className="panel catalog-panel">
              <div className="toolbar">
                <div className="search">
                  <Search size={18} />
                  <input
                    aria-label="Search catalog"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search SKU, barcode, or description…"
                  />
                </div>
                <select
                  aria-label="Filter weights"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All weights</option>
                  <option value="needs">Needs attention</option>
                  <option value="imported">Imported weights</option>
                  <option value="verified">Measured weights</option>
                </select>
                <a className="button" href="/api/export/products">
                  <Download size={16} />
                  Export
                </a>
              </div>
              <div className="table-caption">
                {visibleProducts.length} of {products.length} items · Source
                weights stay flagged until measured here.
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Item / SKU</th>
                      <th>Description</th>
                      <th>Unit weight</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProducts.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong className="sku">{p.sku}</strong>
                          <small>
                            {p.barcode ? `Barcode ${p.barcode}` : "Scan by SKU"}
                          </small>
                        </td>
                        <td>
                          <span className="product-title">{p.title}</span>
                          <small>{p.category}</small>
                          {sharedSkus.has(p.sku.toLowerCase()) && (
                            <small>Shared SKU · {catalogIdentity(p)}</small>
                          )}
                        </td>
                        <td className="nowrap">
                          {number(p.unitWeightOz)} {p.unitWeightOz ? "oz" : ""}
                        </td>
                        <td>
                          <Badge product={p} />
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              disabled={!canEdit}
                              onClick={() => setEditProduct(p)}
                            >
                              Set weight
                            </button>
                            <button
                              className="icon"
                              title="Create bin"
                              aria-label={`Create bin for ${p.sku}`}
                              disabled={!canEdit}
                              onClick={() => setBinEditor({ product: p })}
                            >
                              <Plus size={17} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visibleProducts.length && (
                  <div className="empty">
                    No matching items. Try another SKU or description.
                  </div>
                )}
              </div>
            </section>
          ) : tab === "bins" ? (
            <section className="panel">
              <div className="toolbar">
                <div className="search">
                  <Search size={18} />
                  <input
                    aria-label="Search bins"
                    placeholder="Search bins, locations, or SKUs…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <button
                  className="primary"
                  onClick={() => changeTab("catalog")}
                >
                  <Plus size={17} />
                  Create a bin
                </button>
                <a className="button" href="/api/export/bins">
                  <Download size={16} />
                  Export
                </a>
              </div>
              <div className="bin-grid">
                {visibleBins.map((b) => (
                  <article className="bin-card" key={b.id}>
                    <span className="badge">{b.location || "No location"}</span>
                    <h3>{b.binLabel}</h3>
                    <p>
                      {b.sku} · {b.productTitle}
                    </p>
                    <div className="bin-card-measures">
                      <span>
                        Part <b>{number(b.unitWeightOz)} oz</b>
                      </span>
                      <span>
                        Tare <b>{number(b.emptyBinWeightOz)} oz</b>
                      </span>
                    </div>
                    <small>
                      {date(b.lastCountAt)}
                      {b.lastQuantity !== null && ` · ${b.lastQuantity} units`}
                    </small>
                    <div className="row-actions">
                      <button onClick={() => selectBin(b)}>Count</button>
                      <button onClick={() => setQr(b)}>Label</button>
                      <button
                        onClick={() => {
                          const p = products.find((p) => p.id === b.productId);
                          if (p) setBinEditor({ product: p, bin: b });
                        }}
                        disabled={!canEdit}
                      >
                        Edit
                      </button>
                      <button
                        className="text-button"
                        disabled={!isAdmin}
                        onClick={() => setArchive(b)}
                      >
                        Archive
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!visibleBins.length && (
                <div className="empty">
                  <Boxes size={35} />
                  <h3>No bins yet.</h3>
                  <p>
                    Choose a catalog item, enter its part weight and empty-bin
                    weight, then create its label.
                  </p>
                  <button
                    className="primary"
                    onClick={() => changeTab("catalog")}
                  >
                    Choose a product
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </section>
          ) : (
            <section className="panel">
              <div className="toolbar">
                <h2>{status?.counts || 0} saved counts</h2>
                <a className="button" href="/api/export/counts">
                  <Download size={16} />
                  Export counts
                </a>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time / operator</th>
                      <th>Bin / SKU</th>
                      <th>Total</th>
                      <th>Tare / part</th>
                      <th>Quantity</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {counts.map((c) => (
                      <tr key={c.id}>
                        <td>
                          {date(c.createdAt)}
                          <small>{c.countedBy || "Not specified"}</small>
                        </td>
                        <td>
                          <strong>{c.binLabel}</strong>
                          <small>{c.sku}</small>
                        </td>
                        <td>{number(c.totalWeightOz)} oz</td>
                        <td>
                          {number(c.emptyBinWeightOz)} /{" "}
                          {number(c.unitWeightOz)} oz
                        </td>
                        <td>
                          <strong>{number(c.quantity, 0)}</strong>
                          <small>
                            {c.roundingMode} · raw {number(c.rawQuantity)}
                          </small>
                        </td>
                        <td>{c.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!counts.length && (
                  <div className="empty">
                    <ClipboardList size={35} />
                    <h3>Your count history will appear here.</h3>
                    <p>
                      Saved counts preserve the weights used at the time of
                      measurement.
                    </p>
                  </div>
                )}
              </div>
              {nextCursor && (
                <button
                  className="wide"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const page = await api<{
                        items: Count[];
                        nextCursor: string | null;
                        total: number;
                      }>("/counts?before=" + encodeURIComponent(nextCursor));
                      setCounts((old) => [...old, ...page.items]);
                      setNextCursor(page.nextCursor);
                    })
                  }
                >
                  Load older counts
                </button>
              )}
            </section>
          )}
          <footer>
            iBolt Inventory <span>Inventory only · Manual scale entry</span>
          </footer>
        </main>
      </div>
      {editProduct && (
        <ProductEditor
          product={editProduct}
          close={() => setEditProduct(null)}
          saved={async () => {
            await reload();
            setNotice(
              "Measured product weight saved. Existing bins retain their own calibrated weights.",
            );
          }}
        />
      )}
      {binEditor && (
        <BinEditor
          {...binEditor}
          close={() => setBinEditor(null)}
          saved={async (b) => {
            await reload();
            setSelected(b);
            setPreview(null);
            setBinEditor(null);
            setQr(b);
            setNotice("Bin saved. Its label is ready.");
          }}
        />
      )}
      {qr && (
        <QrLabel
          bin={qr}
          origin={status?.publicOrigin}
          close={() => setQr(null)}
        />
      )}
      {archive && (
        <Modal title="Archive this bin?" close={() => setArchive(null)}>
          <p>
            <strong>{archive.binLabel}</strong> will leave the active bin list.
            Its saved count history is retained.
          </p>
          <div className="modal-actions">
            <button onClick={() => setArchive(null)}>Cancel</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api("/bins/" + archive.id, "DELETE");
                  setArchive(null);
                  setPreview(null);
                  await reload();
                  setNotice("Bin archived. Count history retained.");
                })
              }
            >
              Archive bin
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ProductEditor({
  product: p,
  close,
  saved,
}: {
  product: Product;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [weight, setWeight] = useState(p.unitWeightOz?.toString() || ""),
    [sample, setSample] = useState("1");
  const [barcode, setBarcode] = useState(p.barcode),
    [category, setCategory] = useState(p.category),
    [note, setNote] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const perPart = Number(weight) / Number(sample);
  const rows = (p.source.rows || p.source.weightRows) as any[] | undefined;
  return (
    <Modal title={"Set weight · " + p.sku} close={close}>
      <p>{p.title}</p>
      <Badge product={p} />
      {rows?.length ? (
        <details>
          <summary>View source weight entries ({rows.length})</summary>
          {rows.map((r, i) => (
            <p key={i}>
              Row {r.row || r.sourceRow}: {r.rawWeight || "No weight"}{" "}
              {r.weightOz != null ? `→ ${r.weightOz} oz` : "(needs review)"}
            </p>
          ))}
        </details>
      ) : null}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await api("/products/" + p.id, "PATCH", {
              unitWeightOz: perPart,
              barcode: barcode.trim(),
              category: category.trim(),
              weightNote: note.trim(),
              expectedUpdatedAt: p.updatedAt,
            });
            await saved();
            close();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="two-fields">
          <Field
            label="Measured sample weight (oz)"
            hint="Parts only, without the container."
          >
            <input
              aria-label="Measured sample weight"
              type="number"
              step="any"
              min="0.000001"
              required
              value={weight}
              onChange={(e) => {
                setWeight(e.target.value);
                setConfirmed(false);
              }}
            />
          </Field>
          <Field label="Parts in sample">
            <input
              type="number"
              min="1"
              step="1"
              required
              value={sample}
              onChange={(e) => {
                setSample(e.target.value);
                setConfirmed(false);
              }}
            />
          </Field>
        </div>
        <div className="measurement">
          Unit weight{" "}
          <strong>
            {Number.isFinite(perPart) && perPart > 0 ? number(perPart, 6) : "—"}{" "}
            oz
          </strong>
        </div>
        <Field
          label="Printed barcode (optional)"
          hint="Keep leading zeros. SKU scanning also works."
        >
          <input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label="Category">
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </Field>
        <Field label="Measurement notes">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Scale, sample size, packaging…"
          />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I measured this sample and checked the unit weight.
        </label>
        <p className="hint">
          Existing bins retain their calibrated weights. Edit a bin separately
          when its calibration changes.
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              !confirmed ||
              !weight ||
              !Number.isInteger(Number(sample)) ||
              Number(sample) < 1
            }
          >
            Save measured weight
          </button>
        </div>
      </form>
    </Modal>
  );
}
function BinEditor({
  product: p,
  bin,
  close,
  saved,
}: {
  product: Product;
  bin?: Bin;
  close: () => void;
  saved: (b: Bin) => Promise<void>;
}) {
  const [label, setLabel] = useState(bin?.binLabel || `${p.sku} — Main bin`),
    [weight, setWeight] = useState(
      (bin?.unitWeightOz ?? p.unitWeightOz)?.toString() || "",
    ),
    [tare, setTare] = useState(bin?.emptyBinWeightOz.toString() || ""),
    [location, setLocation] = useState(bin?.location || ""),
    [notes, setNotes] = useState(bin?.notes || ""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={bin ? "Edit bin" : "Create a bin"} close={close}>
      <div className="editor-product">
        <span className="sku">{p.sku}</span>
        <p>{p.title}</p>
        <Badge product={p} />
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const payload = {
              binLabel: label,
              unitWeightOz: Number(weight),
              emptyBinWeightOz: Number(tare),
              location,
              notes,
              weightsConfirmed: true,
              ...(bin
                ? { expectedUpdatedAt: bin.updatedAt }
                : { productId: p.id }),
            };
            const b = await api<Bin>(
              bin ? "/bins/" + bin.id : "/bins",
              bin ? "PATCH" : "POST",
              payload,
            );
            await saved(b);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Bin label">
          <input
            required
            maxLength={160}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field label="Location">
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Aisle A · Rack 2 · Shelf 3"
          />
        </Field>
        <div className="two-fields">
          <Field label="Individual part weight (oz)">
            <input
              required
              type="number"
              min="0.000001"
              step="any"
              value={weight}
              onChange={(e) => {
                setWeight(e.target.value);
                setConfirmed(false);
              }}
            />
          </Field>
          <Field
            label="Empty bin weight (oz)"
            hint="Measure your empty bin. Use 0 only for a tared scale."
          >
            <input
              required
              type="number"
              min="0"
              step="any"
              value={tare}
              onChange={(e) => {
                setTare(e.target.value);
                setConfirmed(false);
              }}
            />
          </Field>
        </div>
        <Field label="Bin notes">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I checked the part weight and empty bin weight.
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || !confirmed || !weight.trim() || !tare.trim()}
          >
            {bin ? "Save bin" : "Create bin & label"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function QrLabel({
  bin,
  origin,
  close,
}: {
  bin: Bin;
  origin?: string;
  close: () => void;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  const payload = origin
    ? `${origin}/?bin=${encodeURIComponent(bin.qrCode)}`
    : `IBOLTINV:${bin.qrCode}`;
  useEffect(() => {
    QRCode.toDataURL(payload, {
      width: 400,
      margin: 2,
      errorCorrectionLevel: "M",
    })
      .then(setUrl)
      .catch((e) => setError(e.message));
  }, [payload]);
  return (
    <Modal title="Bin label" close={close}>
      <div className="print-label">
        <strong>iBOLT INVENTORY</strong>
        <h2>{bin.binLabel}</h2>
        {url && (
          <img className="qr" src={url} alt={`QR label for ${bin.binLabel}`} />
        )}
        <b>SKU {bin.sku}</b>
        <p>{bin.productTitle}</p>
        <p>
          {bin.location} · Part {number(bin.unitWeightOz)} oz · Tare{" "}
          {number(bin.emptyBinWeightOz)} oz
        </p>
        <code>{bin.qrCode}</code>
      </div>
      <p className="hint">
        {origin
          ? "This label opens the configured inventory server."
          : "Portable label: scan it inside this app. It keeps working when the app moves to your server."}
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions">
        {url && (
          <a className="button" href={url} download={bin.qrCode + ".png"}>
            <Download size={16} />
            QR PNG
          </a>
        )}
        <button className="primary" onClick={() => window.print()}>
          <Printer size={16} />
          Print label
        </button>
      </div>
    </Modal>
  );
}
function ClerkAuth() {
  const waitlist = window.location.pathname.startsWith("/sign-up");
  const invitation = window.location.pathname.startsWith("/accept-invitation");
  return (
    <>
      <Show when="signed-out">
        <div className="auth-page">
          <div className="auth-copy">
            <div className="auth-brand">
              iBolt <span>Inventory</span>
            </div>
            <h1>
              {waitlist
                ? "Request inventory access"
                : invitation
                  ? "Accept inventory invitation"
                  : "Sign in to inventory"}
            </h1>
            <p>
              {waitlist
                ? "Submit your work email. An administrator must approve it before you can use the shared inventory."
                : "Approved operators can scan parts, record measured weights, and save physical counts."}
            </p>
          </div>
          {invitation ? (
            <SignUp
              routing="path"
              path="/accept-invitation"
              signInUrl="/sign-in"
              fallbackRedirectUrl="/"
            />
          ) : waitlist ? (
            <Waitlist
              signInUrl="/sign-in"
              afterJoinWaitlistUrl="/sign-up?requested=1"
            />
          ) : (
            <SignIn
              routing="path"
              path="/sign-in"
              waitlistUrl="/sign-up"
              fallbackRedirectUrl="/"
            />
          )}
        </div>
      </Show>
      <Show when="signed-in">
        <App />
      </Show>
    </>
  );
}

async function start() {
  const response = await fetch("/auth-config", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Inventory authentication is unavailable.");
  const config = (await response.json()) as {
    provider: "clerk" | "local";
    clerkPublishableKey: string | null;
    clerkProxyUrl: string | null;
  };
  clerkPublishableKey = config.clerkPublishableKey || "";
  clerkProxyUrl = config.clerkProxyUrl || "";
  clerkEnabled = config.provider === "clerk" && Boolean(clerkPublishableKey);
  createRoot(document.getElementById("root")!).render(
    clerkEnabled ? (
      <ClerkProvider
        publishableKey={clerkPublishableKey}
        proxyUrl={clerkProxyUrl || undefined}
        signInUrl="/sign-in"
        signUpUrl="/accept-invitation"
        waitlistUrl="/sign-up"
        signInFallbackRedirectUrl="/"
        signUpFallbackRedirectUrl="/"
      >
        <ClerkAuth />
      </ClerkProvider>
    ) : (
      <App />
    ),
  );
}

void start().catch((error) => {
  const root = document.getElementById("root")!;
  root.textContent =
    error instanceof Error ? error.message : "Inventory failed to start.";
});
