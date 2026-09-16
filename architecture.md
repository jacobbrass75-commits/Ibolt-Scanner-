# iBOLT Scan architecture

This is an inventory-only application. It records catalog identity, measured part weights, bins, source bin measurements and physical counts. Shopify data is read-only. Inventory is independent of Clerk accounts and is never stored in Git.

## Runtime and records

`server/index.ts` loads validated configuration, opens the configured SQLite database, and runs the Express API plus the React client. Development uses Vite; production serves compiled assets. `server/app.ts` defines API operations, `server/store.ts` manages records, and `server/domain.ts` contains inventory calculations. `server/bin-weights.ts` preserves worksheet provenance and explicit bin setup; `server/db.ts` owns schema migrations.

The service's canonical URL is `https://iboltscan.com`, behind HTTPS nginx on the existing Hetzner host. The domain migration retains the old `inventory.89.167.10.34.nip.io` hostname as a redirect, preserving existing inventory links. `/opt/iboltscan/current` points to a versioned release, while the operating database stays at `/var/lib/iboltscan/inventory.sqlite`. Configuration and secrets live in `/etc/iboltscan/app.env`. Deployment changes the code symlink after a verified backup, preserves the database, limits environment changes to reviewed configuration, and retains the previous release for rollback.

## Manual catalog creation

`POST /api/products` creates a new catalog row for an operator or administrator. The strict request body is `{requestId, sku, title, barcode?, category?, itemType, unitWeightOz?, weightNote?}`: `requestId` is a UUID, SKU and title are required, and `itemType` is `part` or `kit`. Empty optional text defaults to an empty string; an omitted or null weight produces `weightStatus: "missing"`. A supplied positive weight requires a nonempty measurement note and produces `weightStatus: "verified"`. The client converts ounces, pounds, grams or kilograms to ounces and asks the operator to confirm the measurement. No client-supplied identity or component list is accepted.

The `InventoryStore.createProduct` transaction generates a new product ID and writes a `product_created` audit event with the server's actor ID. The existing `products.source` JSON retains `{kind: "manual", itemType, createdBy, createdAt, requestId, creationInput}`. `creationInput` is the immutable, trimmed creation payload, separate from later editable product measurements. No schema migration is required: the schema remains version 4, and manual products use the same product, bin and count structures as imported items.

Retries with the same request ID, actor and normalized creation input return the same product without another insertion or audit event. A changed actor or payload returns HTTP 409. Returning the current product after a later measurement preserves that measurement. Duplicate SKUs are rejected without changing legacy entries that already share a SKU. A new SKU or barcode cannot collide, ignoring case, with an existing product SKU, barcode or alias, or a bin's QR code or ID, including archived bins. Scanner wrappers, control characters and URL payloads that normalize to a different code are rejected as literal catalog identifiers. Leading zeros remain strings.

An assembled kit is one separately identified, countable inventory item. Its unit weight represents one complete assembled kit. There is no bill of materials, component deduction or Shopify writeback. Creating a product does not create bins, counts, imports or stock quantities. Bin setup and physical-count saves remain explicit actions; each bin retains its own calibration and saved counts retain their measurement snapshots. `tests/manual-products.test.ts` covers creation, roles, validation, identity collisions, preservation of legacy records, actor-bound retries, audit rollback and an isolated create-to-lookup-to-bin-to-count flow.

The operator workflow is documented in [Adding parts and assembled kits](docs/ADDING-PARTS-AND-KITS.md). Implementation and test coverage do not establish deployment status; live release activation is verified separately.

## Authentication

The existing **iBolt Inventory** Clerk production application belongs to Jacob's **Ibolt** organization. Registration is open; a verified new account receives the operator role. Only administrator-controlled Clerk public metadata can select an administrator or viewer role. `server/security.ts` enforces authentication, roles, host and origin checks. Remote access requires authenticated HTTPS.

The controlled domain uses the verified Frontend API CNAME `clerk.iboltscan.com`, with `PUBLIC_ORIGIN=https://iboltscan.com` and `CLERK_PROXY_URL` unset. The browser receives the publishable key through `/auth-config`; the secret key remains on the server. `server/clerk-proxy.ts` remains available for explicit proxy configurations and preserves repeated `Set-Cookie` headers; the former deployment also required a 16 KB nginx header buffer. The dedicated Google OAuth web client is configured in Clerk, and the Google audience is External/In production. Public app and privacy disclosures are static files in `client/public`. Domain DNS is verified; the actual login and email checks are tracked separately in [docs/GOOGLE-SIGN-IN.md](docs/GOOGLE-SIGN-IN.md).

`client/src/main.tsx` mounts Clerk sign-in and sign-up components and the inventory workspace. It offers Google or email and directs users opening email-app links to Chrome or Safari. September 15 delivery logs confirmed DMARC rejection for the temporary `nip.io` domain. All three mail records for the controlled domain are verified, and an actual inbox receipt followed by successful email-code sign-in confirmed the new sender works. Google sign-in was separately verified on the new domain. New-user signup has not been completed end to end; preserve recipient-specific suppression evidence until that recipient's delivery succeeds.

`shared/auth-routing.ts` allows returns only to root inventory screens. `shared/clerk-request.ts` waits for a session token and sends it as a Bearer header. An authentication rejection refreshes that token once; persistent rejection opens explicit recovery controls without repeatedly navigating away or clearing open forms. Other failed mutations are never automatically replayed.

## Backups and verification

`server/backups.ts` and the backup scripts create and validate consistent SQLite snapshots with manifests. The server runs hourly backups; the configured PC pulls verified copies when it is online. Details and restore procedures are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Use isolated databases for tests and a disposable database on a separate port for browser inventory QA. Never save synthetic counts into the operating database. Run type checking, the test suite and a production build before deployment. Authentication activation also needs an actual account sign-in check; passing unit tests alone does not prove Google OAuth is live.
