# iBolt Inventory / Iboltscan

A standalone inventory application for product weights, USB and camera scanning, bin labels, and physical count history. There are no writing, publishing, AI-generation, or scheduling components.

## Open the hosted inventory

Open **https://inventory.89.167.10.34.nip.io**. On this configured PC, double-click **Start Inventory.cmd** to open the same hosted app. Sign-in details are in the private local file `private/Inventory Login.txt`. The existing Hetzner server is reused at no added server cost. Named accounts, HTTPS, automatic restart, hourly verified backups, and a restore procedure are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Use the hosted database for all new measurements and counts. The former PC database is preserved; it does not synchronize automatically.

## Local development

To run an isolated local development copy:

```powershell
npm ci
npm run build
npm start
```

Open **http://localhost:5001**. `npm run dev` starts the development server on the same port; run only one server on that port. The launcher reuses a running inventory server and otherwise starts it in the background. Logs are in `data/server.log` and `data/server-error.log`.

See [TESTING-TOMORROW.md](TESTING-TOMORROW.md) for the physical scanner and scale checklist.

## Inventory data

The hosted database is `/var/lib/iboltscan/inventory.sqlite`; the preserved PC copy is `data/inventory.sqlite`. Git does not include inventory records, backups, source workbooks, or credentials. The hosted catalog includes the verified Mac export received September 3, 2026 UTC, reconciled with the existing PC catalog.

- 700 catalog entries: all 627 Shopify variant IDs plus 73 workbook part entries. All 612 Mac parent/source records are represented in provenance, and all 565 earlier PC records retain their IDs.
- 131 imported reference weights, six weight issues requiring physical review, and 563 entries without a part weight. No imported weight is marked physically verified.
- Shared barcodes and SKUs return a choice of items. Distinct Shopify variant IDs remain separate. Three newly received variants share a SKU with a workbook part but lack an established identity link; both entries are retained for review.
- The sole legacy phone-test bin is preserved as archived history. Its 56 oz tare was an unverified default. Create a new bin with measured weights before operational use.
- There are no operational bins or saved counts at migration, and no synthetic test data in the hosted database.

These entry counts are not stock quantities or parent-product totals. Shopify source data was last updated August 26, 2026; it is not a live quantity feed. See [docs/DATA-RECONCILIATION.md](docs/DATA-RECONCILIATION.md) for migration evidence and remaining physical checks.

### Import another catalog

Preview first; the default command writes nothing:

```powershell
npm run import:catalog -- "C:\path\Product Weights - Compact with Part Barcodes.xlsx"
npm run import:catalog -- "C:\path\catalog-backup.sqlite"
```

The preview reports insertions, merges, preserved measurements, barcode collisions, and a `planHash` tied to both the source and current destination. Apply with `--apply --expect-plan <planHash>`; use `--expect-source <SHA256>` to verify a supplied transfer manifest. An existing destination is backed up automatically before any change. The import refuses stale previews or new barcode/SKU collisions by default. After reviewing source identities, `--allow-shared-codes` explicitly retains distinct items behind shared codes; scanning them requires selection. Measured weights and assigned barcodes remain intact, while conflicting unverified weights are flagged for physical review.

The importer also accepts `inventory-transfer.json.txt` exports from the Mac handoff. Catalog import normally leaves bins and counts untouched. The explicit `--archive-legacy-bins` option preserves source bins as archived history and rejects source counts, missing product identities, or existing bin/QR collisions. It is intended for the reviewed historical test bin, not an operational count-history migration. Catalog and historical-bin changes apply in one transaction. SQLite sources are read-only, with active source WALs rejected. Integration credentials and unrelated tables are excluded. Shopify shipping weights are never treated as measured part weights. The compiled command is `node dist/scripts/import-catalog.js <source> --database <destination>`.

## Workflow

1. **Catalog & weights:** find a SKU, weigh one or several identical parts, and save the measured unit weight. Leading zeros in barcodes are preserved. Conflicting or unreadable source weights are left empty for review.
2. **Bins & labels:** assign a product, location, measured part weight, and measured empty-bin weight. No tare value is assumed. Multiple bins may share a SKU.
3. **Scan & count:** scan a bin label or exact product barcode/SKU. Choose a bin when multiple match. Enter the total scale reading in ounces, pounds, grams, or kilograms.
4. Preview, check the result, then save. The server computes `(total ounces - tare ounces) / part ounces`; every count stores its calibration snapshot, rounding mode, notes, operator, and timestamp.
5. Export catalog, bins, and counts as CSV. Administrators can use **Back up inventory** to download a consistent SQLite snapshot. The server also makes hourly verified backups; `npm run backup` uses `BACKUP_DIR` or a `backups/` directory beside the selected database.

The scale is read manually; USB barcode scanners should use keyboard/HID mode with Enter or Tab as the suffix. Direct electronic-scale integration is not implemented. Camera scanning requires browser camera access and HTTPS when accessed remotely. Portable QR labels work inside the app and do not embed localhost. When `PUBLIC_ORIGIN` is configured, newly generated labels can link to the server directly.

## Persistence and safety

- Counts and the bin's latest quantity update in one transaction. Retry requests use an idempotency key so a retry cannot create a duplicate count.
- Editing a product weight does not silently change a bin calibration. Existing count snapshots are immutable.
- Archived bins disappear from active lookup; their history stays available. This version has no count deletion workflow.
- Product and bin calibration changes have a database audit trail.
- SQLite uses WAL and foreign keys. Use the built-in online backup; do not casually copy a live database without its WAL state.
- There are **no Shopify write calls**. Shopify live synchronization is not configured in this standalone version; catalog import is local and offline.
- One host/database should become authoritative before multiple devices start operational counting.

## Development

Node.js 22.12+ is required (22.22.0 verified on Windows).

```powershell
npm run check
npm test
npm run build
```

`server/` contains the Express API, SQLite schema, inventory rules, and authentication. `client/` contains the React UI. `scripts/catalog.ts` reads the workbook and legacy catalog. Tests use isolated databases; browser QA must also use a disposable copy and a different port.

## Headless server

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for service paths, account management, backups, recovery, and deployment verification. Hands-on scanner and scale acceptance is the remaining physical check.
