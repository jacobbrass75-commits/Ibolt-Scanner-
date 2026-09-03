import "dotenv/config";
import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { hashPassword } from "../server/security";
import { usersSchema, userSchema, type AuthUser } from "../server/config";

const [username, displayName, role] = process.argv.slice(2);
if (!username || !displayName || !role)
  throw new Error(
    'Usage: npm run user -- username "Display name" admin|operator|viewer (password on hidden prompt or stdin)',
  );
const filename = path.resolve(
  process.env.AUTH_USERS_FILE || "private/users.json",
);
async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    let value = "";
    for await (const chunk of process.stdin) {
      value += chunk;
      if (value.length > 300) throw new Error("Password input too long.");
    }
    return value.replace(/\r?\n$/, "");
  }
  process.stdout.write("New password (14+ characters, hidden): ");
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (data: string) => {
      for (const char of data) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (value.length < 256) value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}
const user = userSchema.parse({
  username,
  displayName,
  role,
  passwordHash: await hashPassword(await readPassword()),
});
let existing: AuthUser[] = [];
try {
  existing = usersSchema.parse(JSON.parse(await readFile(filename, "utf8")));
} catch (e: any) {
  if (e.code !== "ENOENT") throw e;
}
const users = usersSchema.parse([
  ...existing.filter(
    (u) => u.username.toLowerCase() !== user.username.toLowerCase(),
  ),
  user,
]);
await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
const temporary = filename + "." + randomUUID() + ".tmp";
await writeFile(temporary, JSON.stringify(users, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
await rename(temporary, filename);
await chmod(filename, 0o600);
console.log(
  `Saved ${user.username} (${user.role}). Restart the app to load account changes.`,
);
