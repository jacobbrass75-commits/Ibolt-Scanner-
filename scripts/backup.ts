import "dotenv/config";
import { mkdirSync } from "node:fs";
import { openDatabase } from "../server/db";
const db = openDatabase();
mkdirSync("backups", { recursive: true });
const filename = `backups/inventory-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
await db.backup(filename);
db.close();
console.log(`Backup saved: ${filename}`);
