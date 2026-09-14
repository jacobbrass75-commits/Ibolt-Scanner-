# iBOLT Scan architecture

This is an inventory-only application. It records catalog identity, measured part weights, bins, source bin measurements and physical counts. Shopify data is read-only. Inventory is independent of Clerk accounts and is never stored in Git.

## Runtime and records

`server/index.ts` loads validated configuration, opens the configured SQLite database, and runs the Express API plus the React client. Development uses Vite; production serves compiled assets. `server/app.ts` defines API operations, `server/store.ts` manages records, and `server/domain.ts` contains inventory calculations. `server/bin-weights.ts` preserves worksheet provenance and explicit bin setup; `server/db.ts` owns schema migrations.

The live service runs behind HTTPS nginx on the existing Hetzner host. `/opt/iboltscan/current` points to a versioned release, while the operating database stays at `/var/lib/iboltscan/inventory.sqlite`. Configuration and secrets live in `/etc/iboltscan/app.env`. Deployment changes the code symlink after a verified backup, preserves the database and environment, and retains the previous release for rollback.

## Authentication

The existing **iBolt Inventory** Clerk production application belongs to Jacob's **Ibolt** organization. Registration is open; a verified new account receives the operator role. Only administrator-controlled Clerk public metadata can select an administrator or viewer role. `server/security.ts` enforces authentication, roles, host and origin checks. Remote access requires authenticated HTTPS.

`server/clerk-proxy.ts` forwards Clerk through `/__clerk` on the inventory origin and preserves every `Set-Cookie` header. The browser receives only the publishable key and public proxy URL from `/auth-config`; the secret key remains on the server. Google production authentication additionally requires a Google OAuth web client configured in Clerk. Current activation evidence is in [docs/GOOGLE-SIGN-IN.md](docs/GOOGLE-SIGN-IN.md).

`client/src/main.tsx` mounts Clerk sign-in and sign-up components and the inventory workspace. `shared/auth-routing.ts` allows returns only to root inventory screens. `shared/clerk-request.ts` waits for a session token and sends it as a Bearer header. An authentication rejection refreshes that token once; persistent rejection opens explicit recovery controls without repeatedly navigating away or clearing open forms. Other failed mutations are never automatically replayed.

## Backups and verification

`server/backups.ts` and the backup scripts create and validate consistent SQLite snapshots with manifests. The server runs hourly backups; the configured PC pulls verified copies when it is online. Details and restore procedures are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Use isolated databases for tests and a disposable database on a separate port for browser inventory QA. Never save synthetic counts into the operating database. Run type checking, the test suite and a production build before deployment. Authentication activation also needs an actual account sign-in check; passing unit tests alone does not prove Google OAuth is live.
