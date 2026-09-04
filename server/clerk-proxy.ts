import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { RequestHandler } from "express";
import { clerkFrontendApiProxy } from "@clerk/backend/proxy";

// The Express SDK's response.setHeader loop overwrites repeated Set-Cookie
// headers. Keep the official proxy logic, but transport cookies as an array.
export function clerkProxy(
  options: { proxyUrl: string; publishableKey: string; secretKey: string },
  proxy = clerkFrontendApiProxy,
): RequestHandler {
  const configured = new URL(options.proxyUrl);
  const proxyPath = configured.pathname.replace(/\/$/, "");
  return async (req, res, next) => {
    if (req.path !== proxyPath && !req.path.startsWith(proxyPath + "/")) {
      next();
      return;
    }
    if (req.headers.host !== configured.host) {
      res.status(403).end();
      return;
    }
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined)
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      headers.set("x-forwarded-host", configured.host);
      headers.set("x-forwarded-proto", configured.protocol.slice(0, -1));
      const init: RequestInit & { duplex?: "half" } = {
        method: req.method,
        headers,
      };
      if (!["GET", "HEAD"].includes(req.method)) {
        init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
        init.duplex = "half";
      }
      const upstream = await proxy(
        new Request(new URL(req.originalUrl, configured.origin), init),
        {
          proxyPath,
          publishableKey: options.publishableKey,
          secretKey: options.secretKey,
        },
      );
      res.status(upstream.status);
      upstream.headers.forEach((value, name) => {
        if (name.toLowerCase() !== "set-cookie") res.setHeader(name, value);
      });
      const cookies = upstream.headers.getSetCookie();
      if (cookies.length) res.setHeader("Set-Cookie", cookies);
      if (upstream.body)
        await pipeline(
          Readable.fromWeb(
            upstream.body as import("node:stream/web").ReadableStream,
          ),
          res,
        );
      else res.end();
    } catch (error) {
      next(error);
    }
  };
}
