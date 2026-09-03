import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import {
  mkdir,
  chmod,
  rename,
  writeFile,
  copyFile,
  stat,
  statfs,
  readdir,
  readFile,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { SCHEMA_VERSION, type InventoryDatabase } from "./db";

export function inspectBackup(filename: string) {
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    if (
      db.pragma("integrity_check", { simple: true }) !== "ok" ||
      (db.pragma("foreign_key_check") as unknown[]).length
    )
      throw new Error("Backup database integrity check failed.");
    const schema = db.pragma("user_version", { simple: true }) as number;
    if (schema < 1 || schema > SCHEMA_VERSION)
      throw new Error("Unsupported backup schema.");
    if (
      !(db.pragma("table_info(products)") as { name: string }[]).some(
        (c) => c.name === "unitWeightOz",
      )
    )
      throw new Error("Not an Iboltscan backup.");
    const totals: Record<string, number> = {};
    for (const table of ["products", "bins", "counts", "audit", "imports"])
      totals[table] = (
        db.prepare(`SELECT count(*) AS total FROM ${table}`).get() as {
          total: number;
        }
      ).total;
    return { schema, totals };
  } finally {
    db.close();
  }
}
export async function fileHash(filename: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}
export async function createBackup(db: InventoryDatabase, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const disk = await statfs(directory);
  if (disk.bavail * disk.bsize < 1024 * 1024 * 1024)
    throw new Error(
      "Less than 1 GB of backup disk space remains. Free space before creating another backup.",
    );
  const createdAt = new Date().toISOString();
  const filename = path.resolve(
    directory,
    `inventory-${createdAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.sqlite`,
  );
  const partial = filename + ".partial";
  await db.backup(partial);
  // Make the completed snapshot self-contained; never copy a live WAL database.
  const snapshot = new Database(partial);
  try {
    snapshot.pragma("journal_mode = DELETE");
  } finally {
    snapshot.close();
  }
  const report = inspectBackup(partial);
  const manifest = { createdAt, sha256: await fileHash(partial), ...report };
  await chmod(partial, 0o600);
  await rename(partial, filename);
  await writeFile(
    filename + ".json",
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return { filename, manifest };
}
export async function pruneBackups(directory: string, now = Date.now()) {
  const names = (await readdir(directory))
    .filter((name) =>
      /^inventory-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9]{8}\.sqlite$/.test(name),
    )
    .sort()
    .reverse();
  let removed = 0;
  // Only our own complete snapshots, older than 30 days, with 24 recent files retained.
  for (const name of names.slice(24)) {
    const filename = path.resolve(directory, name);
    const info = await stat(filename);
    if (now - info.mtimeMs < 30 * 86400000) continue;
    let manifest: { sha256: string; createdAt: string };
    try {
      manifest = JSON.parse(await readFile(filename + ".json", "utf8"));
    } catch {
      continue;
    }
    if (
      !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
      !Number.isFinite(Date.parse(manifest.createdAt))
    )
      continue;
    await unlink(filename);
    await unlink(filename + ".json");
    removed++;
  }
  return removed;
}
export async function restoreToNewFile(
  source: string,
  destination: string,
  expectedHash: string,
) {
  if (path.resolve(source) === path.resolve(destination))
    throw new Error("Restore into a NEW database path.");
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      await stat(destination + suffix);
    } catch (e: any) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    throw new Error(
      "Destination already exists. Restore into a new path; never overwrite an operating database.",
    );
  }
  try {
    if ((await stat(source + "-wal")).size > 0)
      throw new Error(
        "Source has an active WAL. Create an online backup first.",
      );
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  const report = inspectBackup(source);
  if ((await fileHash(source)) !== expectedHash)
    throw new Error("Backup checksum does not match its manifest.");
  await mkdir(path.dirname(path.resolve(destination)), {
    recursive: true,
    mode: 0o700,
  });
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  await chmod(destination, 0o600);
  if ((await fileHash(destination)) !== expectedHash)
    throw new Error(
      "Restored file checksum failed. Do not start this database.",
    );
  return report;
}
