import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { RequestHandler } from "express";
import type { AuthUser, Identity } from "./config";
import { isLoopback } from "./config";
import { loginPage, loginCss, safeReturn } from "./login";

const derive = promisify(scrypt);
export async function hashPassword(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  if (password.length < 14 || password.length > 256)
    throw new Error("Use a password between 14 and 256 characters.");
  const key = (await derive(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string) {
  if (password.length > 256) return false;
  const [, salt, expected] = hash.split("$");
  const key = (await derive(password, salt, 64)) as Buffer;
  return timingSafeEqual(key, Buffer.from(expected, "hex"));
}
type SecurityOptions = {
  users?: AuthUser[];
  password?: string;
  publicOrigin?: string;
  development?: boolean;
  now?: () => number;
  maxFailures?: number;
};
export function security(options: SecurityOptions): RequestHandler {
  const now = options.now || Date.now;
  const attempts = new Map<string, { count: number; expires: number }>();
  const cache = new Map<string, { identity: Identity; expires: number }>();
  const sessions = new Map<string, { identity: Identity; expires: number }>();
  const cookieName = options.publicOrigin ? "__Host-iboltscan" : "iboltscan";
  const cookie = (value: string, maxAge: number) =>
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${options.publicOrigin ? "; Secure" : ""}`;
  let verifying = 0;
  const users = new Map(
    options.users?.map((u) => [u.username.toLowerCase(), u]),
  );
  const challenge = (
    req: Parameters<RequestHandler>[0],
    res: Parameters<RequestHandler>[1],
  ) => {
    if (req.path === "/login" && req.method === "POST") {
      res.status(401).type("html").send(loginPage(req.body?.returnTo, true));
      return;
    }
    if (req.method === "GET" && !req.path.startsWith("/api/")) {
      res.redirect(
        303,
        "/login?returnTo=" + encodeURIComponent(safeReturn(req.originalUrl)),
      );
      return;
    }
    res.status(401).json({ error: "Inventory sign-in required." });
  };
  return async (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Permissions-Policy",
      "camera=(self), microphone=(), geolocation=()",
    );
    res.setHeader("Cache-Control", "no-store");
    if (!options.development)
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
    const host = req.headers.host || "";
    const local = isLoopback(req.socket.remoteAddress || "");
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    if (
      !localHost &&
      (!options.publicOrigin || host !== new URL(options.publicOrigin).host)
    ) {
      res.status(403).json({ error: "Unrecognized inventory host." });
      return;
    }
    if (options.publicOrigin && host === new URL(options.publicOrigin).host)
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    // Liveness exposes only status and is available on the private backend for supervisors.
    if (req.path === "/healthz" && req.method === "GET") {
      next();
      return;
    }
    if (!options.users && !options.password && !local) {
      res.status(403).json({ error: "Remote access requires authentication." });
      return;
    }
    const origin = req.headers.origin;
    if (
      (origin && origin !== (options.publicOrigin || `http://${host}`)) ||
      (req.headers["sec-fetch-site"] === "cross-site" &&
        !["GET", "HEAD"].includes(req.method))
    ) {
      res
        .status(403)
        .json({ error: "Requests must come from this inventory app." });
      return;
    }
    if (req.method === "GET" && req.path === "/login.css") {
      res.type("css").send(loginCss);
      return;
    }
    if (req.method === "GET" && req.path === "/login") {
      res.type("html").send(loginPage(req.query.returnTo));
      return;
    }
    const login = req.path === "/login" && req.method === "POST";
    const logout = req.path === "/logout" && req.method === "POST";
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !login &&
      !logout &&
      Number(req.headers["content-length"] || 0) > 0 &&
      !req.is("application/json")
    ) {
      res.status(415).json({ error: "Send JSON from the inventory app." });
      return;
    }
    const localIdentity: Identity = {
      username: "local-operator",
      displayName: "Local operator",
      role: "admin",
      authenticated: false,
    };
    if (!options.users && !options.password) {
      res.locals.identity = localIdentity;
      next();
      return;
    }
    for (const [key, session] of sessions)
      if (session.expires <= now()) sessions.delete(key);
    const token = (req.headers.cookie || "")
      .split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    const sessionKey = token
      ? createHash("sha256").update(token).digest("hex")
      : "";
    if (logout) {
      sessions.delete(sessionKey);
      res.setHeader("Set-Cookie", cookie("", 0));
      res.redirect(303, "/login");
      return;
    }
    const session = sessions.get(sessionKey);
    if (session && !login) {
      res.locals.identity = session.identity;
      next();
      return;
    }
    const loginUser =
      typeof req.body?.username === "string" ? req.body.username : "";
    const loginPassword =
      typeof req.body?.password === "string" ? req.body.password : "";
    const auth = login
      ? "Basic " +
        Buffer.from(loginUser + ":" + loginPassword).toString("base64")
      : req.headers.authorization || "";
    if (!auth.startsWith("Basic ") || auth.length > 2048) {
      challenge(req, res);
      return;
    }
    const fingerprint = createHash("sha256").update(auth).digest("hex");
    const cached = cache.get(fingerprint);
    if (cached && cached.expires > now() && !login) {
      res.locals.identity = cached.identity;
      next();
      return;
    }
    // Never trust caller-controlled forwarding headers. Per-user and per-peer limits remain
    // enforced behind a proxy; its own IP rate limit can additionally distinguish clients.
    const credentials = Buffer.from(auth.slice(6), "base64").toString("utf8");
    const colon = credentials.indexOf(":");
    const username = credentials.slice(0, colon).toLowerCase();
    const password = credentials.slice(colon + 1);
    const peer = req.socket.remoteAddress || "unknown";
    const keys = [`peer:${peer}`, `user:${username}`];
    for (const [key, value] of attempts)
      if (value.expires <= now()) attempts.delete(key);
    if (
      attempts.size > 5000 ||
      keys.some(
        (k) => (attempts.get(k)?.count || 0) >= (options.maxFailures || 12),
      )
    ) {
      res.setHeader("Retry-After", "900");
      res
        .status(429)
        .json({ error: "Too many sign-in attempts. Try again later." });
      return;
    }
    if (verifying >= 4) {
      res.setHeader("Retry-After", "1");
      res.status(503).json({ error: "Sign-in is busy. Retry shortly." });
      return;
    }
    verifying++;
    try {
      const user = users.get(username);
      let valid = false;
      if (options.users) {
        // Unknown usernames take the same password derivation path.
        const hash = user?.passwordHash || options.users[0].passwordHash;
        valid =
          (await verifyPassword(password, hash)) && Boolean(user) && colon > 0;
      } else if (options.password && colon > 0)
        valid = timingSafeEqual(
          createHash("sha256").update(password).digest(),
          createHash("sha256").update(options.password).digest(),
        );
      if (!valid) {
        for (const key of keys) {
          const previous = attempts.get(key);
          attempts.set(key, {
            count: (previous?.count || 0) + 1,
            expires: previous?.expires || now() + 900000,
          });
        }
        challenge(req, res);
        return;
      }
      const identity: Identity = user
        ? {
            username: user.username,
            displayName: user.displayName,
            role: user.role,
            authenticated: true,
          }
        : {
            ...localIdentity,
            username: "pilot-operator",
            displayName: "Pilot operator",
            authenticated: true,
          };
      if (login) {
        if (sessions.size >= 1000) {
          res.status(503).send("Sign-in is busy. Please try again later.");
          return;
        }
        if (sessionKey) sessions.delete(sessionKey);
        const value = randomBytes(32).toString("base64url");
        sessions.set(createHash("sha256").update(value).digest("hex"), {
          identity,
          expires: now() + 8 * 3600000,
        });
        res.setHeader("Set-Cookie", cookie(value, 8 * 3600));
        res.redirect(303, safeReturn(req.body?.returnTo));
        return;
      }
      if (cache.size >= 1000) cache.clear();
      cache.set(fingerprint, { identity, expires: now() + 60000 });
      res.locals.identity = identity;
      next();
    } catch (error) {
      next(error);
    } finally {
      verifying--;
    }
  };
}
export function requireRole(...roles: Identity["role"][]): RequestHandler {
  return (_req, res, next) => {
    if (!roles.includes((res.locals.identity as Identity).role)) {
      res.status(403).json({
        error: "Your account does not have permission for this action.",
      });
      return;
    }
    next();
  };
}
