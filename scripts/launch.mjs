import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
config({ path: path.join(root, ".env") });
const port = process.env.PORT || "5001";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
  throw new Error("PORT must be a number from 1 to 65535.");
const url = `http://localhost:${port}`;
async function health() {
  try {
    const response = await fetch(url + "/api/health", {
      signal: AbortSignal.timeout(1500),
      headers: process.env.ACCESS_PASSWORD
        ? {
            Authorization:
              "Basic " +
              Buffer.from("operator:" + process.env.ACCESS_PASSWORD).toString(
                "base64",
              ),
          }
        : {},
    });
    return response.ok && (await response.json()).app === "iboltscan";
  } catch {
    return false;
  }
}
if (!(await health())) {
  if (!existsSync("dist/server.js"))
    throw new Error("Run npm install, then npm run build first.");
  mkdirSync("data", { recursive: true });
  const out = openSync("data/server.log", "a"),
    err = openSync("data/server-error.log", "a");
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: root,
    env: process.env,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out, err],
  });
  child.unref();
  closeSync(out);
  closeSync(err);
  writeFileSync(
    "data/server-process.json",
    JSON.stringify({
      pid: child.pid,
      root,
      startedAt: new Date().toISOString(),
    }),
  );
  let ready = false;
  for (let i = 0; i < 30; i++) {
    if (await health()) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready)
    throw new Error(
      "The inventory server did not start. Check data/server-error.log; another app may be using the port.",
    );
}
console.log(`Inventory ready: ${url}`);
if (process.platform === "win32")
  spawn(
    "powershell.exe",
    ["-NoProfile", "-Command", `Start-Process '${url}'`],
    { detached: true, windowsHide: true, stdio: "ignore" },
  ).unref();
