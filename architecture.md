# iBOLT Scan architecture

This is an inventory-only application. It records catalog identity, measured part weights, bins, source bin measurements and physical counts. Shopify data is read-only. Inventory is independent of Clerk accounts and is never stored in Git.

## Runtime and records

`server/index.ts` loads validated configuration, opens the configured SQLite database, and runs the Express API plus the React client. Development uses Vite; production serves compiled assets. `server/app.ts` defines API operations, `server/store.ts` manages records, and `server/domain.ts` contains inventory calculations. `server/bin-weights.ts` preserves worksheet provenance and explicit bin setup; `server/db.ts` owns schema migrations.

The service's canonical URL is `https://iboltscan.com`, behind HTTPS nginx on the existing Hetzner host. The domain migration retains the old `inventory.89.167.10.34.nip.io` hostname as a redirect, preserving existing inventory links. `/opt/iboltscan/current` points to a versioned release, while the operating database stays at `/var/lib/iboltscan/inventory.sqlite`. Configuration and secrets live in `/etc/iboltscan/app.env`. Deployment changes the code symlink after a verified backup, preserves the database, limits environment changes to reviewed configuration, and retains the previous release for rollback.

## Authentication

The existing **iBolt Inventory** Clerk production application belongs to Jacob's **Ibolt** organization. Registration is open; a verified new account receives the operator role. Only administrator-controlled Clerk public metadata can select an administrator or viewer role. `server/security.ts` enforces authentication, roles, host and origin checks. Remote access requires authenticated HTTPS.

The controlled domain uses the verified Frontend API CNAME `clerk.iboltscan.com`, with `PUBLIC_ORIGIN=https://iboltscan.com` and `CLERK_PROXY_URL` unset. The browser receives the publishable key through `/auth-config`; the secret key remains on the server. `server/clerk-proxy.ts` remains available for explicit proxy configurations and preserves repeated `Set-Cookie` headers; the former deployment also required a 16 KB nginx header buffer. The dedicated Google OAuth web client is configured in Clerk, and the Google audience is External/In production. Public app and privacy disclosures are static files in `client/public`. Domain DNS is verified; the actual login and email checks are tracked separately in [docs/GOOGLE-SIGN-IN.md](docs/GOOGLE-SIGN-IN.md).

`client/src/main.tsx` mounts Clerk sign-in and sign-up components and the inventory workspace. It offers Google or email and directs users opening email-app links to Chrome or Safari. September 15 delivery logs confirmed DMARC rejection for the temporary `nip.io` domain. All three mail records for the controlled domain are verified, and an actual inbox receipt followed by successful email-code sign-in confirmed the new sender works. Google sign-in was separately verified on the new domain. New-user signup has not been completed end to end; preserve recipient-specific suppression evidence until that recipient's delivery succeeds.

`shared/auth-routing.ts` allows returns only to root inventory screens. `shared/clerk-request.ts` waits for a session token and sends it as a Bearer header. An authentication rejection refreshes that token once; persistent rejection opens explicit recovery controls without repeatedly navigating away or clearing open forms. Other failed mutations are never automatically replayed.

## Backups and verification

`server/backups.ts` and the backup scripts create and validate consistent SQLite snapshots with manifests. The server runs hourly backups; the configured PC pulls verified copies when it is online. Details and restore procedures are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Use isolated databases for tests and a disposable database on a separate port for browser inventory QA. Never save synthetic counts into the operating database. Run type checking, the test suite and a production build before deployment. Authentication activation also needs an actual account sign-in check; passing unit tests alone does not prove Google OAuth is live.
