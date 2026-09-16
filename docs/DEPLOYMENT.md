# Hosted inventory operations

The canonical inventory URL is **https://iboltscan.com** on the existing Hetzner `ubuntu-4gb-hel1-2` server (`89.167.10.34`). No new server was purchased. The domain was registered through Cloudflare on September 15, 2026. Actual email-code and Google sign-in have loaded the live app on the new domain; verification details are recorded below.

The server is the operating database. On the configured PC, `Start Inventory.cmd` reads the private `hosted-url.txt` and opens this address. Do not enter operational counts into the old PC copy. That copy remains preserved for recovery and reconciliation.

## Manual parts and assembled kits — 2026-09-16

Release **a335ddd07fd5ad37b8d6046b8bfcad3108c519ae** activated at approximately 21:59 UTC. It adds **Add part / kit** to the inventory catalog. Type checking, all **47 tests**, and production builds passed on Windows and Linux. Browser creation, duplicate rejection, scanner Enter handling, leading-zero barcode lookup, weight conversion and count preview were verified on a disposable database. No test products, bins or counts were submitted to operating inventory.

A fresh verified online backup immediately preceded activation: `/var/backups/iboltscan/inventory-2026-09-16T21-59-00-014Z-3f233e48.sqlite` with its adjacent JSON manifest (SHA-256 `965bfffcae8ebb4c8a59f72069de70a64db1c8541142db8d3f526579054455a0`). All six table fingerprints were unchanged across deployment: **700 products, 24 bins, 32 counts, 1,578 audit rows, 4 imports and 116 bin measurements**. Schema remains **4**; no migration, environment, nginx, DNS or authentication configuration changes were made. Only the inventory service restarted; the prior `b9ee003` release remains available for code rollback. Preserve any subsequently created operating records during rollback.

Post-deployment Google sign-in returned the existing owner administrator account. The live catalog showed 700 products, 23 active bins and 32 counts; **Add part / kit** opened with the assembled-kit option. HTTPS sign-in returned 200 and anonymous product API access returned 401. Inventory, hourly backups and the certificate timer are active. Activation evidence is under `/var/lib/iboltscan/access/manual-products-20260916/activation-a335ddd07fd5ad37b8d6046b8bfcad3108c519ae-20260916T215859Z-257498`.

## Current authentication checkpoint — 2026-09-15

`iboltscan.com` is registered and Active in Cloudflare. Apex and `www` DNS are configured, and Clerk verifies all five required CNAME records, including all three email records. The same Clerk production instance has migrated to the new domain; its Frontend API is now `clerk.iboltscan.com` and the Google OAuth callback has been updated. At 17:50 UTC a real verification email reached the owner's inbox; entering its code completed sign-in at 17:51–17:52 UTC with the original administrator role and **Database connected**. A separate Google flow through the account chooser also loaded the canonical inventory with the same administrator role. New-user registration is open but has not been completed end to end for a previously unregistered account. See [GOOGLE-SIGN-IN.md](GOOGLE-SIGN-IN.md) for the current evidence.

The migration keeps `inventory.89.167.10.34.nip.io` and `www.iboltscan.com` as redirects to the canonical apex. Retain a valid HTTPS certificate on the old hostname, preserve path and query when redirecting old inventory links, and verify a bookmarked bin-weight URL after activation. The database remains on the same host and path.

### Email-failure checkpoint — earlier on 2026-09-15

Production Clerk delivery logs showed sender-authentication bounces (`550 5.7.26`, `nip.io` DMARC) and recipient suppression. The same-origin Clerk proxy did not replace mail DNS authentication. Release `3f5f7c2` directed users to Google while mail delivery was unavailable. The new sender's verified email-code sign-in supports removing that notice. Inspect logs for any previously suppressed recipient during their next attempt; one successful recipient does not establish that all suppressions are cleared.

Release **3f5f7c2** deployed that guidance on September 15 at 16:41 UTC. Type checking, all 42 tests, and the production build passed on Windows and Linux; the notice was visually checked in a separate static preview with no database access. A verified backup preceded activation. All six table fingerprints and the protected environment were unchanged; the service and hourly backup timer remained active. At that point the custom domain was not yet registered. Registration and DNS setup completed later in the same day's migration.

### Google activation evidence — 2026-09-14

Release **e1febb0** went live with open Clerk registration, Google sign-in, bounded session recovery, and public app/privacy pages. The original production application was transferred into Jacob's **Ibolt** organization, preserving its keys and existing accounts. Google's audience was External and In production; the actual Google sign-in flow loaded inventory with the owner's existing administrator role. Anonymous inventory APIs still require authentication. See [GOOGLE-SIGN-IN.md](GOOGLE-SIGN-IN.md) for the activation evidence.

The former `/__clerk` nginx location used 16 KB response-header buffers after a repeat Google callback exceeded the default and returned 502. The vhost was backed up, `nginx -t` passed, and a graceful reload applied the change. A fresh sign-in succeeded and returned to Bin weights. The new domain uses Clerk's verified Frontend API CNAME instead; the proxy details remain relevant to rollback of the former deployment.

Type checking, all 42 tests and production builds passed locally and on Linux. A verified snapshot preceded deployment. All six table fingerprints and the protected environment were identical before and after activation: 700 products, 17 bins, 19 counts, 1571 audit rows, 4 imports and 116 bin measurements. The service and hourly backup timer are active; the snapshot was verified on the PC too. The previous release remains available for rollback.

## Inventory checkpoint — 2026-09-10

The **Bin weights** page contains 116 source measurements from 85 worksheet rows, with 42 reference part weights applied to unique catalog matches. All 700 catalog records, the archived legacy bin, and count history were preserved. Eleven measurements across nine worksheet rows need a catalog match. Container tare and whether the source weights include the container remain unconfirmed, so the import created no operational bins or physical counts. The page supports measured setup after those details are checked. See [BIN-WEIGHTS.md](BIN-WEIGHTS.md).

Schema 4 adds source bin measurements and includes them in backup manifests. Pre-import and post-import backups were verified, and a post-import snapshot was copied to the PC with its checksum verified. The inventory service, hourly backup timer, and Clerk authentication remain in place. Signed-out home-page visits are routed to the dedicated sign-in page with the requested inventory screen retained; this avoids mounting the path-based sign-in component outside its configured route.

## Previous authentication checkpoint — 2026-09-04

At that checkpoint, release `602b1df` used Clerk production Waitlist authentication and the same-origin `/__clerk` proxy. The owner has created a password-enabled account with administrator access. This release fixes repeated `Set-Cookie` headers being overwritten by the Express SDK proxy, which caused the password step to forget the sign-in attempt. The application now uses Clerk's official backend proxy with a cookie-preserving Express response adapter. All 27 tests, type checking, and production builds passed locally and on the Linux server. Live HTTP checks confirmed all Clerk cookies are forwarded, and Brave retained the password step after navigation. Unauthenticated inventory API access still returns 401. Final password submission and authenticated inventory workflow verification require the owner's participation.

An operator invitation was issued for the requested coworker and delivered through Gmail using Clerk's private proxy-aware invitation URL. No account was created on the coworker's behalf; she must complete signup. No inventory records were changed. Google sign-in remains disabled because no production OAuth client is configured. Clerk's sign-in, invitation sign-up, and sign-out paths point at this application.

Linux type checking, all 26 tests, and the build passed. Verified snapshots before and after activation had identical SHA-256 and totals (700 products, 1 bin, 0 counts, 1394 audit rows, 3 imports). Only `iboltscan` restarted; nginx was validated and reloaded for the inventory proxy. The pre-Clerk environment and prior release remain available for rollback. Temporary credential-transfer copies were removed; the active secret is confined to the protected service environment. Revocation of the original unused Clerk setup key remains pending owner approval.

## Service layout

| Item                 | Location                                                    |
| -------------------- | ----------------------------------------------------------- |
| Service              | `iboltscan.service`, starts at boot and restarts on failure |
| Code                 | `/opt/iboltscan/current` → a versioned release              |
| Private runtime      | `/opt/iboltscan/node/bin/node` (22.23.2)                    |
| Persistent inventory | `/var/lib/iboltscan/inventory.sqlite`                       |
| Configuration        | `/etc/iboltscan/app.env`                                    |
| Hashed accounts      | `/etc/iboltscan/users.json`                                 |
| Backups              | `/var/backups/iboltscan/`                                   |
| Proxy                | `/etc/nginx/sites-available/iboltscan.conf`                 |
| Backend              | `127.0.0.1:5010`, accessible only on the server             |

The app runs as the dedicated `iboltscan` account with a 512 MB memory limit, a read-only application directory, and access to its own writable data and backup directories. Existing hosted apps retain their runtimes and ports. The repository contains no credentials or inventory data.

## Legacy sign-in and roles (rollback reference)

Sign in with a named account through the normal sign-in page. The browser receives a random, HttpOnly, Secure, SameSite=Strict cookie lasting eight hours. Sessions end on sign-out, expiration, or an app restart. Saved counts use the authenticated account identity; the client cannot supply another operator's identity. Account passwords are stored as salted scrypt hashes, with sign-in throttling. HTTP Basic remains available for authenticated API clients over HTTPS.

- **Operator:** read, scan, preview/save counts, calibrate products and bins.
- **Viewer:** read, scan, preview, export; cannot change inventory.
- **Administrator:** operator access plus archive bins and create/download backups.

The initial administrator is `jacob`. The generated password is in the PC's ignored `private/Inventory Login.txt`, not this repository. Use Sign out on shared devices. To create or rotate an account, run the compiled user tool on the host with a hidden password prompt:

```sh
cd /opt/iboltscan/current
AUTH_USERS_FILE=/etc/iboltscan/users.json /opt/iboltscan/node/bin/node dist/scripts/manage-user.js username 'Display name' operator
chown root:iboltscan /etc/iboltscan/users.json
chmod 640 /etc/iboltscan/users.json
systemctl restart iboltscan
```

The tool also accepts the password on stdin for private automation. Do not pass it as a command argument, write it into Git, or print it in logs. Editing accounts requires a restart, which revokes existing sessions.

### Clerk open registration

The application can use Clerk instead of the local users file. Configure the two runtime values below in the protected service environment; never commit or print the secret key:

```text
CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
PUBLIC_ORIGIN=https://iboltscan.com
```

Leave `CLERK_PROXY_URL` unset when using the verified `clerk.iboltscan.com` Frontend API. Do not configure `AUTH_USERS_FILE` at the same time. The server exposes the publishable key to the browser through `/auth-config`; the secret key stays server-side. Clerk's Express middleware verifies sessions with `authorizedParties` restricted to `PUBLIC_ORIGIN`. Authenticated users default to the `operator` role. Set Clerk public metadata `role` to `admin`, `operator`, or `viewer` when a different role is required.

In Jacob's Ibolt Clerk organization, set **Access mode** to **Open** and leave the email allowlist disabled. `/sign-up` creates an account directly; no administrator approval is required. Keep email verification enabled. Production Google sign-in requires the dedicated OAuth connection described in [GOOGLE-SIGN-IN.md](GOOGLE-SIGN-IN.md).

The app embeds Clerk's invitation sign-up component at `/accept-invitation`. If an invitation is needed, use the canonical HTTPS origin for its redirect. Clerk validates invitation tickets; preserve the legacy route for existing invitation links.

The former free `nip.io` hostname could not publish Clerk's requested CNAME records. Its proxy solved Frontend API routing but not email sender authentication. The controlled `iboltscan.com` domain uses the five exact CNAME records supplied by the same Clerk production instance. Keep those records verified and preserve the existing instance and accounts when changing domains.

Create a Clerk production instance before replacing live authentication. Build and test a separate release, install both keys into the protected service environment, take a verified inventory backup, and then use the normal reviewed deployment procedure. Do not reuse keys from another Clerk application or put development keys into the live service.

## Backups and recovery

`iboltscan-backup.timer` creates an online SQLite snapshot every hour. Each completed backup has an adjacent JSON manifest with SHA-256, schema version, record totals, and creation time. Integrity and foreign keys are checked. The backup script prunes its own complete snapshots older than 30 days while retaining at least 24 files. It refuses new snapshots when less than 1 GB of disk is free.

The Windows task **Iboltscan-Backup-Pull** copies recent snapshots to this PC's `backups/remote/` hourly and at sign-in, while Jacob is signed in and the PC is online. It uses the existing SSH identity with strict host-key verification, checks SHA-256, SQLite integrity, foreign keys, schema, and record totals, and catches up at most 24 recent snapshots per run. It keeps 30 days with at least 24 files retained. The first transfer and an off-server restore were verified. Its status is in the ignored `private/backup-pull-status.json`; Task Scheduler reports nonzero exit codes on failure and retries twice.

When this PC is offline, hourly backups continue on the server and off-server copies resume when the PC is available. This is not a continuously available off-site storage service. Keep the JSON manifest with the SQLite file. The in-app download gives a consistent SQLite file; its checksum is also returned in `X-Backup-SHA256`, and its full manifest remains in the server backup directory.

Run a pull manually from this PC with `node dist/scripts/pull-backup.js root@89.167.10.34`. The registration script `deploy/register-backup-pull.ps1 -SshTarget root@89.167.10.34` creates the task on a configured Windows checkout; it refuses to overwrite an existing task. Inventory passwords are never stored in the scheduled task.

Check service health and backup results:

```sh
systemctl status iboltscan --no-pager
curl -fsS http://127.0.0.1:5010/healthz
systemctl show iboltscan-backup --property=Result,ExecMainStatus
systemctl list-timers iboltscan-backup.timer certbot.timer
journalctl -u iboltscan -u iboltscan-backup --since today
df -h /var/lib/iboltscan
```

Restore into a **new** path, never over a live database:

```sh
cd /opt/iboltscan/current
/opt/iboltscan/node/bin/node dist/scripts/restore.js /path/backup.sqlite /var/lib/iboltscan/restored.sqlite
chown iboltscan:iboltscan /var/lib/iboltscan/restored.sqlite
```

The tool requires the backup's adjacent `.json` manifest and verifies checksums, integrity, and record totals. Stop the app, preserve its current database and WAL sidecars, change `DATABASE_PATH` to the verified restored file, and start the app. Check totals and a known no-save calculation before reopening counting. Do not delete the prior database as part of restoration.

## Release changes

Build/test a separate release with Node 22, then run `npm prune --omit=dev`. Keep source and native packages compatible with Linux; do not upload Windows `node_modules`. Take a verified online backup before switching versions or applying a migration. Point `/opt/iboltscan/current` at the new release and restart only `iboltscan`. Schema 2 adds authenticated actors; earlier records are marked `legacy`. Schema 3 permits different product IDs to share a SKU, preserving distinct Shopify variants. Future unsupported schemas are refused. A schema-changing rollback needs its matching backup, not just an older code directory.

Nginx owns HTTPS, HTTP redirects, and a request rate limit. Certbot renews the certificate automatically; its inventory-specific deploy hook validates and reloads nginx. Validate nginx before reloading and preserve all other vhosts. Do not expose Vite or the backend port publicly.

## Acceptance

Type check, automated inventory/security/import tests, and build pass on Windows and the target Linux server. Public HTTPS, unauthorized-request rejection, catalog lookup, service restart, first hourly backup, and a restored off-server copy were verified. The browser preview/save test used a disposable database with a known ten-part quantity; no synthetic counts were added to operating inventory.

The Mac transfer was checksum-verified and reconciled on a restored backup before production import. The deployed catalog has 700 entries, all 627 Shopify variant IDs, 131 imported reference weights, and six unresolved weights. The historical phone-test bin is archived with its original ID and QR code. No operational bins or saved counts existed at migration. Shared-barcode and shared-SKU browser scans correctly require item selection. See `docs/DATA-RECONCILIATION.md`. Physical scanner and scale validation remains the hands-on acceptance step in `TESTING-TOMORROW.md`.
