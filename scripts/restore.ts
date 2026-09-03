import { readFile } from "node:fs/promises";
import { restoreToNewFile } from "../server/backups";
const [source, destination] = process.argv.slice(2);
if (!source || !destination)
  throw new Error(
    "Usage: npm run restore -- backup.sqlite NEW-database.sqlite",
  );
const manifest = JSON.parse(await readFile(source + ".json", "utf8"));
if (!/^[a-f0-9]{64}$/.test(manifest.sha256))
  throw new Error("A valid adjacent backup manifest is required.");
console.log(
  JSON.stringify(await restoreToNewFile(source, destination, manifest.sha256)),
);
