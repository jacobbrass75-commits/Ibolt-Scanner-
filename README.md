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

The hosted database is `/var/lib/iboltscan/inventory.sqlite`; the preserved PC copy is `data/inventory.sqlite`. Git does not include inventory records, backups, source workbooks, or credentials. The deployed catalog came from the available older local catalog and weight workbook. **It is not the newer Mac database described in the email.**

- Local source database: 345 Shopify product records expanded into 492 stock items/variants.
- Workbook: 144 rows, 137 unique parts; 64 merged by exact SKU and 73 added.
- Combined PC catalog: 565 stock items, with 131 imported usable part weights and 6 weight issues requiring physical review.
- Workbook barcode cells were empty. SKU scanning works. Product variants also retain any barcode data present in the local catalog. Printed barcodes can be assigned in **Catalog & weights**.
- No bins or count events were present in that source database. No synthetic test data is in the working database.

These item counts are not directly comparable to parent Shopify product counts. The newer Mac handoff reports 612 product records, one bin, and zero counts. Transfer its consistent SQLite backup privately before reconciling newer products and that bin. Do not replace the PC database after entering real measurements: import and reconcile changes instead.

### Import another catalog

Preview first; the default command writes nothing:

```powershell
npm run import:catalog -- "C:\path\Product Weights - Compact with Part Barcodes.xlsx"
npm run import:catalog -- "C:\path\catalog-backup.sqlite"
```

Back up first, then append `--apply` to import. The importer copies catalog fields only, reads the source SQLite database with read-only access, merges by exact SKU, preserves locally verified weights, records source-file hashes, and skips already imported files. It does **not** restore legacy bins or count history. It does not copy integration credentials or unrelated tables. Original source rows remain inspectable for weight conflicts. Shopify shipping weights are never treated as measured part weights.

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

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for service paths, account management, backups, recovery, and deployment verification. Recurring off-host backup and the newer Mac catalog transfer are still outstanding.
