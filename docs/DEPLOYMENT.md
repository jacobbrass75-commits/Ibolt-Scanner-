# Hosted inventory operations

Inventory runs at **https://inventory.89.167.10.34.nip.io** on the existing Hetzner `ubuntu-4gb-hel1-2` server (`89.167.10.34`). No new server was purchased. This is a free IP-based hostname; a custom domain can be added later with a matching certificate and `PUBLIC_ORIGIN` update.

The server is the operating database. On the configured PC, `Start Inventory.cmd` reads the private `hosted-url.txt` and opens this address. Do not enter operational counts into the old PC copy. That copy remains preserved for recovery and reconciliation.

## Service layout

| Item | Location |
| --- | --- |
| Service | `iboltscan.service`, starts at boot and restarts on failure |
| Code | `/opt/iboltscan/current` → a versioned release |
| Private runtime | `/opt/iboltscan/node/bin/node` (22.23.2) |
| Persistent inventory | `/var/lib/iboltscan/inventory.sqlite` |
| Configuration | `/etc/iboltscan/app.env` |
| Hashed accounts | `/etc/iboltscan/users.json` |
| Backups | `/var/backups/iboltscan/` |
| Proxy | `/etc/nginx/sites-available/iboltscan.conf` |
| Backend | `127.0.0.1:5010`, accessible only on the server |

The app runs as the dedicated `iboltscan` account with a 512 MB memory limit, a read-only application directory, and access to its own writable data and backup directories. Existing hosted apps retain their runtimes and ports. The repository contains no credentials or inventory data.

## Sign-in and roles

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

Build/test a separate release with Node 22, then run `npm prune --omit=dev`. Keep source and native packages compatible with Linux; do not upload Windows `node_modules`. Take a verified online backup before switching versions or applying a migration. Point `/opt/iboltscan/current` at the new release and restart only `iboltscan`. Database schema 2 adds authenticated actors without changing historical counts; earlier records are explicitly marked `legacy`. Future unsupported schemas are refused. A schema-changing rollback needs its matching backup, not just an older code directory.

Nginx owns HTTPS, HTTP redirects, and a request rate limit. Certbot renews the certificate automatically; its inventory-specific deploy hook validates and reloads nginx. Validate nginx before reloading and preserve all other vhosts. Do not expose Vite or the backend port publicly.

## Acceptance and data still needed

Type check, automated inventory/security/import tests, and build pass on Windows and the target Linux server. Public HTTPS, unauthorized-request rejection, catalog lookup, service restart, first hourly backup, and a restored off-server copy were verified. The browser preview/save test used a disposable database with a known ten-part quantity; no synthetic counts were added to operating inventory.

The deployed snapshot has 565 stock items, 131 imported weights, six conflicting weights, zero bins, and zero counts. It comes from the older local catalog plus workbook. The newer Mac handoff describes a separate 612-product snapshot with one bin; it is still needed for catalog reconciliation. Those parent-product totals are not directly comparable to variant-expanded stock items. Physical scanner and scale validation remains the hands-on acceptance step in `TESTING-TOMORROW.md`.
