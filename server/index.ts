import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { existsSync } from "node:fs";

const config = loadConfig();
const { host, port } = config;
if (config.mode === "production" && !existsSync(config.databasePath))
  throw new Error(
    "Production database is missing. Restore a verified inventory backup before starting.",
  );
const db = openDatabase(config.databasePath);
const production = fileURLToPath(import.meta.url).endsWith(".js");
const app = createApp(db, { ...config, development: !production });
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
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;
server.on("error", (error) => {
  console.error(error.message);
  db.close();
  process.exit(1);
});
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => {
      server.closeAllConnections();
      db.close();
      process.exit(1);
    }, 20000);
    timeout.unref();
    server.close(() => {
      clearTimeout(timeout);
      db.close();
      process.exit(0);
    });
  });
