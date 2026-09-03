# Headless deployment preparation

No deployment has been performed. The headless host, private access method, hostname, and backup destination can be configured when supplied.

## Runtime

Use Node.js 22.12+ and a persistent local disk. Do not put a live SQLite database on a network filesystem. Build with `npm ci` and `npm run build`; run `node dist/server.js` under the host's service manager with automatic restart.

The application binds to `127.0.0.1:5001` by default. For a reverse proxy or container, set these through the host's private configuration:

```dotenv
HOST=0.0.0.0
PORT=5001
DATABASE_PATH=/var/lib/iboltscan/inventory.sqlite
ACCESS_PASSWORD=<strong private password>
PUBLIC_ORIGIN=https://<private inventory hostname>
```

`ACCESS_PASSWORD` enables HTTP Basic authentication (any operator username, the configured password); a valid password is required for reads, writes, downloads, and backups. Use it only behind HTTPS. This is a single-workspace pilot login, not individual user accounts or roles. `Counted by` is an operator-entered audit label. Add per-user identity before a larger rollout.

The reverse proxy must preserve the public Host header, use the configured exact HTTPS origin, and forward only to the app's local port. Keep the backend port private. Add proxy-level rate limiting to authentication. Do not expose Vite's development server.

## Transfer the operating database

1. Decide when the PC stops taking counts. Create an online backup from the app or `npm run backup`.
2. Transfer the backup privately. Preserve the original source and PC database.
3. On the stopped destination app, restore the backup to the configured `DATABASE_PATH` and set owner-only filesystem permissions.
4. Verify SQLite integrity, product/weight/bin/count totals, and a known no-save calculation.
5. Start the service and HTTPS proxy. Verify authentication and a scanner lookup from each device.
6. Use the server as the single authoritative database. Git does not synchronize records between machines.

## Backups

Run the online backup script on a service schedule, with encrypted off-host copies and a retention policy chosen by the owner. Schedule restore drills. Monitor available disk space and failed backups. The app's download backup is a manual pilot fallback.

## QR and hardware

Existing portable `IBOLTINV:` labels continue to scan inside the app. Newly generated labels use `PUBLIC_ORIGIN` for direct links. Phone camera scanning needs that HTTPS origin and browser permission. USB HID scanners need Enter or Tab suffixes. Direct scale drivers are outside this version.

## Deployment checks

Run `npm run check`, `npm test`, and `npm run build` on the target platform. Verify the native SQLite dependency, persistent storage, authentication, HTTPS camera access, backup restoration, and a ten-part sample count before operational use.
