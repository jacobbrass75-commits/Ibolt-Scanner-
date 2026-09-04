import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { get } from "node:http";
import express from "express";
import { clerkProxy } from "../server/clerk-proxy";

test("Clerk proxy preserves every cookie and streams sign-in requests", async () => {
  const app = express();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  const origin = `http://127.0.0.1:${port}`;
  const cookies = [
    "__client=example; Path=/; HttpOnly; Secure; SameSite=Lax",
    "__client_uat=1; Path=/; Expires=Fri, 04 Sep 2026 23:00:00 GMT; Secure",
    "_cfuvid=example; Path=/; HttpOnly; Secure",
  ];
  let calls = 0;
  app.use(
    clerkProxy(
      {
        proxyUrl: origin + "/__clerk",
        publishableKey: "test",
        secretKey: "test",
      },
      async (request) => {
        calls++;
        assert.equal(request.method, "POST");
        assert.equal(
          await request.text(),
          "identifier=operator%40example.test",
        );
        assert.equal(
          new URL(request.url).pathname,
          "/__clerk/v1/client/sign_ins",
        );
        const headers = new Headers({ "Content-Type": "application/json" });
        cookies.forEach((cookie) => headers.append("Set-Cookie", cookie));
        return new Response('{"status":"needs_first_factor"}', {
          status: 200,
          headers,
        });
      },
    ),
  );
  app.use((_req, res) => res.status(401).end());
  try {
    const response = await fetch(origin + "/__clerk/v1/client/sign_ins", {
      method: "POST",
      body: "identifier=operator%40example.test",
    });
    assert.deepEqual(response.headers.getSetCookie(), cookies);
    assert.equal((await response.json()).status, "needs_first_factor");
    assert.equal((await fetch(origin + "/api/status")).status, 401);
    assert.equal((await fetch(origin + "/__clerk-other")).status, 401);
    const wrongHostStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        get(
          origin + "/__clerk/v1/client",
          { headers: { Host: "wrong.example" } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        ).on("error", reject);
      },
    );
    assert.equal(wrongHostStatus, 403);
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
