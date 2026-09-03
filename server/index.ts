import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db";
import { createApp } from "./app";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5001);
if (
  !["127.0.0.1", "::1", "localhost"].includes(host) &&
  (!process.env.ACCESS_PASSWORD || !process.env.PUBLIC_ORIGIN)
)
  throw new Error("Remote hosting requires ACCESS_PASSWORD and PUBLIC_ORIGIN.");
if (
  process.env.PUBLIC_ORIGIN &&
  new URL(process.env.PUBLIC_ORIGIN).protocol !== "https:"
)
  throw new Error("PUBLIC_ORIGIN must use HTTPS.");
const db = openDatabase();
const app = createApp(db, {
  password: process.env.ACCESS_PASSWORD,
  publicOrigin: process.env.PUBLIC_ORIGIN,
});
const production = fileURLToPath(import.meta.url).endsWith(".js");
if (production) {
  const publicPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "public",
  );
  app.use(express.static(publicPath));
  app.get("*", (_req, res) =>
    res.sendFile(path.join(publicPath, "index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, host, () =>
  console.log(`iBolt Inventory is ready at http://${host}:${port}`),
);
server.on("error", (error) => {
  console.error(error.message);
  db.close();
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
