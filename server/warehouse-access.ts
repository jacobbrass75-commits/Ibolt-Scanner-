import express from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Identity, WarehouseAccessConfig } from "./config";

export function warehouseAccess(
  config: WarehouseAccessConfig | undefined,
  options: { publicOrigin?: string; now?: () => number } = {},
) {
  const router = express.Router(),
    now = options.now || Date.now;
  const expires = config ? Date.parse(config.expiresAt) : 0;
  const cookieName = options.publicOrigin
    ? "__Host-iboltscan-warehouse"
    : "iboltscan-warehouse";
  const active = () => !!config && Number.isFinite(expires) && now() < expires;
  const valid = (token: unknown) =>
    typeof token === "string" &&
    /^[a-f0-9]{64}$/.test(token) &&
    active() &&
    timingSafeEqual(
      createHash("sha256").update(token).digest(),
      Buffer.from(config!.tokenHash, "hex"),
    );
  router.use((req, res, next) => {
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    if (valid(cookie)) {
      const identity: Identity = {
        username: "warehouse-link",
        displayName: "Warehouse team",
        role: "operator",
        authenticated: false,
        accessMode: "warehouse",
        accessExpiresAt: config!.expiresAt,
      };
      res.locals.warehouseIdentity = identity;
    }
    next();
  });
  const protectEntry: express.RequestHandler = (req, res, next) => {
    const expected = options.publicOrigin || `http://${req.headers.host}`;
    const expectedHost = new URL(expected).host;
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(
      req.headers.host || "",
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    if (
      (options.publicOrigin && req.headers.host !== expectedHost) ||
      (!options.publicOrigin && !localHost)
    ) {
      res.status(403).json({ error: "Unrecognized inventory host." });
      return;
    }
    if (options.publicOrigin)
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    if (
      req.method === "POST" &&
      (req.headers.origin !== expected ||
        req.headers["sec-fetch-site"] === "cross-site")
    ) {
      res
        .status(403)
        .json({ error: "Open the warehouse link in this inventory app." });
      return;
    }
    next();
  };
  router.get("/warehouse", protectEntry, (_req, res) => {
    const nonce = randomBytes(18).toString("base64");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    );
    res.type("html")
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Warehouse access · iBolt Inventory</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f8;color:#182f43;font:16px system-ui,sans-serif;padding:24px}main{max-width:480px;background:white;border:1px solid #e1e6eb;border-radius:16px;padding:32px}h1{font-size:27px}p{line-height:1.6}a{color:#1a6b63}</style></head><body><main><h1>iBolt warehouse access</h1><p id="message" role="status">Opening inventory…</p><a href="/sign-in">Use account sign-in</a></main><script nonce="${nonce}">
const key = new URLSearchParams(location.hash.slice(1)).get('key');
history.replaceState(null, '', '/warehouse');
const message = document.getElementById('message');
if (!key) message.textContent = 'Open the full temporary warehouse link you were sent, or use account sign-in.';
else fetch('/warehouse-access', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({key})})
  .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); location.replace('/'); })
  .catch(error => {message.textContent = error.message || 'Warehouse access is unavailable. Please reopen your link.';});
</script></body></html>`);
  });
  router.post(
    "/warehouse-access",
    protectEntry,
    express.json({ limit: "2kb" }),
    (req, res) => {
      if (!valid(req.body?.key)) {
        res
          .status(403)
          .json({
            error:
              "This warehouse link is invalid or expired. Ask for a fresh link, or use account sign-in.",
          });
        return;
      }
      const maxAge = Math.max(0, Math.floor((expires - now()) / 1000));
      res.setHeader(
        "Set-Cookie",
        `${cookieName}=${req.body.key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Expires=${new Date(expires).toUTCString()}${options.publicOrigin ? "; Secure" : ""}`,
      );
      res.json({ expiresAt: config!.expiresAt });
    },
  );
  router.post("/warehouse-exit", protectEntry, (_req, res) => {
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${options.publicOrigin ? "; Secure" : ""}`,
    );
    res.redirect(303, "/sign-in");
  });
  return router;
}
