import test from "node:test";
import assert from "node:assert/strict";
import {
  createClerkRequest,
  InventorySessionError,
} from "../shared/clerk-request";
import { inventoryScreen } from "../shared/auth-routing";

test("Clerk API waits for its token and sends it with the unchanged inventory request", async () => {
  let ready!: (token: string) => void;
  const token = new Promise<string>((resolve) => {
    ready = resolve;
  });
  let calls = 0;
  const request = createClerkRequest(
    () => token,
    async (url, init) => {
      calls++;
      assert.equal(url, "/api/calculate");
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, '{"save":true,"requestId":"stable"}');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer ready-token");
      assert.equal(headers.get("Content-Type"), "application/json");
      return Response.json({ saved: true });
    },
  );
  const pending = request("/api/calculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"save":true,"requestId":"stable"}',
  });
  await Promise.resolve();
  assert.equal(calls, 0);
  ready("ready-token");
  assert.equal((await pending).status, 200);
  assert.equal(calls, 1);
});

test("a stale token refreshes once and a rejected count request keeps its original body", async () => {
  const refresh: (boolean | undefined)[] = [];
  const bodies: BodyInit[] = [];
  const request = createClerkRequest(
    async (options) => {
      refresh.push(options?.skipCache);
      return options?.skipCache ? "fresh" : "stale";
    },
    async (_url, init) => {
      bodies.push(init!.body!);
      return new Response(null, {
        status:
          new Headers(init?.headers).get("Authorization") === "Bearer fresh"
            ? 200
            : 401,
      });
    },
  );
  const body = '{"requestId":"same-count-attempt"}';
  assert.equal(
    (await request("/api/calculate", { method: "POST", body })).status,
    200,
  );
  assert.deepEqual(refresh, [undefined, true]);
  assert.deepEqual(bodies, [body, body]);
});

test("persistent server rejection stops after one refresh with a recoverable error", async () => {
  let tokens = 0,
    requests = 0;
  const request = createClerkRequest(
    async () => {
      tokens++;
      return "rejected";
    },
    async () => {
      requests++;
      return new Response(null, { status: 401 });
    },
  );
  await assert.rejects(request("/api/status"), InventorySessionError);
  assert.equal(tokens, 2);
  assert.equal(requests, 2);
});

test("missing or expired sessions stop without anonymous inventory requests", async () => {
  let requests = 0;
  const request = createClerkRequest(
    async () => null,
    async () => {
      requests++;
      return new Response(null, { status: 200 });
    },
  );
  await assert.rejects(request("/api/status"), InventorySessionError);
  assert.equal(requests, 0);
  let tokens = 0;
  const expiresDuringRefresh = createClerkRequest(
    async () => (++tokens === 1 ? "old" : null),
    async () => {
      requests++;
      return new Response(null, { status: 401 });
    },
  );
  await assert.rejects(
    expiresDuringRefresh("/api/status"),
    InventorySessionError,
  );
  assert.equal(requests, 1);
});

test("inventory errors and ambiguous network failures never replay a mutation", async () => {
  for (const status of [403, 409, 429, 500]) {
    let calls = 0;
    const request = createClerkRequest(
      async () => "valid",
      async () => {
        calls++;
        return new Response(null, { status });
      },
    );
    assert.equal(
      (await request("/api/calculate", { method: "POST" })).status,
      status,
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  const request = createClerkRequest(
    async () => "valid",
    async () => {
      calls++;
      throw new Error("connection lost");
    },
  );
  await assert.rejects(
    request("/api/calculate", { method: "POST" }),
    /connection lost/,
  );
  assert.equal(calls, 1);
});

test("sign-in recovery preserves warehouse destinations without nesting auth URLs", () => {
  assert.equal(inventoryScreen("/", "?view=bin-weights"), "/?view=bin-weights");
  assert.equal(
    inventoryScreen("/sign-in", "?returnTo=%2F%3Fview%3Dbin-weights"),
    "/?view=bin-weights",
  );
  assert.equal(
    inventoryScreen("/sign-up", "?returnTo=%2F%3Fbin%3DIBOLT-123"),
    "/?bin=IBOLT-123",
  );
  for (const search of [
    "",
    "?returnTo=%2Fsign-in%3FreturnTo%3D%252F",
    "?returnTo=https%3A%2F%2Fevil.test",
    "?returnTo=%2F%2Fevil.test",
  ])
    assert.equal(inventoryScreen("/sign-in", search), "/");
});
