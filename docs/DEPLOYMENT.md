# Hosted inventory operations

Inventory runs at **https://inventory.89.167.10.34.nip.io** on the existing Hetzner `ubuntu-4gb-hel1-2` server (`89.167.10.34`). No new server was purchased. This is a free IP-based hostname; a custom domain can be added later with a matching certificate and `PUBLIC_ORIGIN` update.

The server is the operating database. On the configured PC, `Start Inventory.cmd` reads the private `hosted-url.txt` and opens this address. Do not enter operational counts into the old PC copy. That copy remains preserved for recovery and reconciliation.

## Current deployment checkpoint — 2026-09-04

Release `602b1df` is live with Clerk production Waitlist authentication and the same-origin `/__clerk` proxy. The owner has created a password-enabled account with administrator access. This release fixes repeated `Set-Cookie` headers being overwritten by the Express SDK proxy, which caused the password step to forget the sign-in attempt. The application now uses Clerk's official backend proxy with a cookie-preserving Express response adapter. All 27 tests, type checking, and production builds passed locally and on the Linux server. Live HTTP checks confirmed all Clerk cookies are forwarded, and Brave retained the password step after navigation. Unauthenticated inventory API access still returns 401. Final password submission and authenticated inventory workflow verification require the owner's participation.

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

### Clerk approval mode

The application can use Clerk instead of the local users file. Configure the two runtime values below in the protected service environment; never commit or print the secret key:

```text
CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
CLERK_PROXY_URL=https://inventory.89.167.10.34.nip.io/__clerk
```

Do not configure `AUTH_USERS_FILE` at the same time. The server exposes the publishable key to the browser through `/auth-config`; the secret key stays server-side. Clerk's Express middleware verifies sessions with `authorizedParties` restricted to `PUBLIC_ORIGIN`. Approved users default to the `operator` role. Set Clerk public metadata `role` to `admin`, `operator`, or `viewer` when a different role is required.

In the Clerk Dashboard, set **Access mode** to **Waitlist** and keep email enabled. `/sign-up` becomes the request-access page. An administrator approves a request from Clerk's Waitlist screen; Clerk then emails the invitation. Until approval, the requester cannot create an active inventory session. `/sign-in` is for approved users only.

The app embeds Clerk's invitation sign-up component at `/accept-invitation`. For this proxy-only deployment, create invitations with `redirectUrl` set to that HTTPS route so they do not depend on the unconfigured Account Portal hostname. Clerk validates the invitation ticket; this page does not bypass Waitlist access controls.

The free `nip.io` hostname cannot publish Clerk's requested CNAME records. For this deployment, set the production domain's Frontend API to the proxy URL above. The Express middleware serves that same-origin proxy before authentication and the client receives only the public proxy URL. Configure the proxy in Clerk only after the release is live and `https://inventory.89.167.10.34.nip.io/__clerk` resolves; Clerk validates it before enabling the instance.

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
