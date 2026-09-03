import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
export function openDatabase(
  filename = process.env.DATABASE_PATH || "./data/inventory.sqlite",
) {
  if (filename !== ":memory:")
    mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new Database(filename);
  // This repository owns a new database, never the original application database.
  const legacy = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE name IN ('ibolt_products','blog_posts','companies')",
    )
    .get();
  if (legacy) {
    db.close();
    throw new Error(
      "Use import:catalog to copy inventory records into a NEW database. Do not run against a legacy database.",
    );
  }
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, sku TEXT NOT NULL, title TEXT NOT NULL, barcode TEXT NOT NULL DEFAULT '',
      aliases TEXT NOT NULL DEFAULT '[]', category TEXT NOT NULL DEFAULT '',
      unitWeightOz REAL CHECK(unitWeightOz > 0), weightStatus TEXT NOT NULL DEFAULT 'missing',
      weightNote TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '{}', updatedAt TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS product_sku ON products(sku COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS bins (
      id TEXT PRIMARY KEY, productId TEXT NOT NULL REFERENCES products(id), sku TEXT NOT NULL,
      productTitle TEXT NOT NULL, binLabel TEXT NOT NULL, qrCode TEXT NOT NULL UNIQUE COLLATE NOCASE,
      unitWeightOz REAL NOT NULL CHECK(unitWeightOz > 0), emptyBinWeightOz REAL NOT NULL CHECK(emptyBinWeightOz >= 0),
      location TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
      lastQuantity INTEGER, lastCountAt TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS counts (
      id TEXT PRIMARY KEY, requestId TEXT NOT NULL UNIQUE, binId TEXT NOT NULL REFERENCES bins(id),
      sku TEXT NOT NULL, binLabel TEXT NOT NULL, productTitle TEXT NOT NULL,
      totalWeightOz REAL NOT NULL, emptyBinWeightOz REAL NOT NULL, unitWeightOz REAL NOT NULL,
      netWeightOz REAL NOT NULL, rawQuantity REAL NOT NULL, quantity INTEGER NOT NULL,
      roundingMode TEXT NOT NULL, countedBy TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS counts_time ON counts(createdAt DESC);
    CREATE INDEX IF NOT EXISTS bins_product ON bins(productId);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, recordId TEXT NOT NULL, beforeValue TEXT, afterValue TEXT, createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY, sourceFile TEXT NOT NULL, sourceHash TEXT NOT NULL UNIQUE, summary TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    PRAGMA user_version = 1;
  `);
  return db;
}
export type InventoryDatabase = ReturnType<typeof openDatabase>;
