import "dotenv/config";
import Database from "better-sqlite3";
import path from "node:path";
import { createBackup, pruneBackups } from "../server/backups";
const filename = path.resolve(
  process.env.DATABASE_PATH || "data/inventory.sqlite",
);
const db = new Database(filename, { readonly: true, fileMustExist: true });
try {
  const directory =
    process.env.BACKUP_DIR || path.join(path.dirname(filename), "backups");
  const result = await createBackup(db, directory);
  console.log(
    JSON.stringify({
      ...result,
      expiredBackupsRemoved: await pruneBackups(directory),
    }),
  );
} finally {
  db.close();
}
