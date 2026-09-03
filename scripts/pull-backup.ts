import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  statfs,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileHash, inspectBackup, pruneBackups } from "../server/backups";

const run = promisify(execFile);
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  import.meta.url.endsWith(".ts") ? ".." : "../..",
);
const directory = path.join(root, "backups", "remote");
const statusFile = path.join(root, "private", "backup-pull-status.json");
const host = process.argv[2];
if (!host || !/^[a-zA-Z][a-zA-Z0-9_-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host))
  throw new Error(
    "Usage: node dist/scripts/pull-backup.js user@known-inventory-host",
  );
const options = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "ConnectTimeout=8",
];
const remoteDirectory = "/var/backups/iboltscan";
const namePattern = /^inventory-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9]{8}\.sqlite$/;
await mkdir(directory, { recursive: true, mode: 0o700 });
await mkdir(path.dirname(statusFile), { recursive: true, mode: 0o700 });
const partialFiles: string[] = [];
try {
  const disk = await statfs(directory);
  if (disk.bavail * disk.bsize < 1024 * 1024 * 1024)
    throw new Error("Less than 1 GB is free on the PC backup disk.");
  const listing = await run(
    "ssh",
    [
      ...options,
      host,
      `find ${remoteDirectory} -maxdepth 1 -type f -name 'inventory-*.sqlite' -printf '%f\\n'`,
    ],
    { timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true },
  );
  const names = listing.stdout
    .split(/\r?\n/)
    .filter((name) => namePattern.test(name))
    .sort()
    .reverse();
  if (!names.length)
    throw new Error("The server has no completed inventory backup.");
  let copied = 0,
    latest: Record<string, unknown> | undefined;
  // Catch up recent missed backups, with a bounded transfer on each run.
  for (const name of names.slice(0, 24)) {
    const destination = path.join(directory, name);
    if (existsSync(destination) && existsSync(destination + ".json")) {
      if (!latest) {
        const existing = JSON.parse(
          await readFile(destination + ".json", "utf8"),
        );
        if ((await fileHash(destination)) !== existing.sha256)
          throw new Error(
            "An existing PC backup failed checksum verification.",
          );
        latest = { filename: name, ...existing };
      }
      continue;
    }
    const token = randomUUID();
    const partial = destination + ".partial-" + token;
    const manifestFile = partial + ".json";
    partialFiles.push(partial, manifestFile);
    await run(
      "scp",
      [...options, `${host}:${remoteDirectory}/${name}.json`, manifestFile],
      { timeout: 30000, windowsHide: true },
    );
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    if (
      !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
      !Number.isFinite(Date.parse(manifest.createdAt))
    )
      throw new Error("The backup manifest is invalid.");
    await run(
      "scp",
      [...options, `${host}:${remoteDirectory}/${name}`, partial],
      { timeout: 60000, windowsHide: true },
    );
    if ((await fileHash(partial)) !== manifest.sha256)
      throw new Error("Downloaded backup checksum does not match.");
    const inspected = inspectBackup(partial);
    if (
      inspected.schema !== manifest.schema ||
      JSON.stringify(inspected.totals) !== JSON.stringify(manifest.totals)
    )
      throw new Error(
        "Downloaded backup record totals differ from the manifest.",
      );
    if (existsSync(destination))
      throw new Error(
        "An incomplete local backup already occupies the destination; inspect it before retrying.",
      );
    await rename(partial, destination);
    await rename(manifestFile, destination + ".json");
    copied++;
    if (!latest) latest = { filename: name, ...manifest };
  }
  if (
    !latest ||
    Date.now() - Date.parse(String(latest.createdAt)) > 3 * 3600000
  )
    throw new Error(
      "The latest server backup is more than three hours old. Check the server backup timer.",
    );
  const expiredBackupsRemoved = await pruneBackups(directory);
  const result = {
    status: "ok",
    checkedAt: new Date().toISOString(),
    host,
    copied,
    latest,
    destination: directory,
    expiredBackupsRemoved,
  };
  await writeFile(statusFile, JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(JSON.stringify(result));
} catch (error: any) {
  const message =
    error.code === "ETIMEDOUT" || error.killed
      ? "Backup transfer timed out."
      : error.message;
  await writeFile(
    statusFile,
    JSON.stringify(
      { status: "error", checkedAt: new Date().toISOString(), message },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.error(message);
  process.exitCode = 1;
} finally {
  for (const filename of partialFiles)
    await unlink(filename).catch((error) => {
      if (error.code !== "ENOENT")
        console.error("Could not remove incomplete backup:", filename);
    });
}
