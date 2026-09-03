import path from "node:path";
import { readFileSync } from "node:fs";
import { z } from "zod";

export const userSchema = z
  .object({
    username: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/),
    displayName: z.string().trim().min(1).max(100),
    role: z.enum(["admin", "operator", "viewer"]),
    passwordHash: z.string().regex(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/),
  })
  .strict();
export const usersSchema = z
  .array(userSchema)
  .min(1)
  .max(100)
  .superRefine((users, ctx) => {
    if (
      new Set(users.map((u) => u.username.toLowerCase())).size !== users.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Usernames must be unique, ignoring case.",
      });
    if (!users.some((u) => u.role === "admin"))
      ctx.addIssue({
        code: "custom",
        message: "At least one administrator is required.",
      });
  });
export type AuthUser = z.infer<typeof userSchema>;
export type Identity = Pick<AuthUser, "username" | "displayName" | "role"> & {
  authenticated: boolean;
};
export const isLoopback = (host: string) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"].includes(host);
export function loadUsers(filename: string): AuthUser[] {
  return usersSchema.parse(JSON.parse(readFileSync(filename, "utf8")));
}
export function loadConfig(env = process.env) {
  const mode = z.enum(["local", "production"]).parse(env.APP_MODE || "local");
  const host = env.HOST || "127.0.0.1";
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(env.PORT || 5001);
  let publicOrigin: string | undefined;
  if (env.PUBLIC_ORIGIN) {
    const url = new URL(env.PUBLIC_ORIGIN);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error(
        "PUBLIC_ORIGIN must be an HTTPS origin without a path, query, or credentials.",
      );
    publicOrigin = url.origin;
  }
  const users = env.AUTH_USERS_FILE
    ? loadUsers(env.AUTH_USERS_FILE)
    : undefined;
  if (mode === "production" && (!users || !publicOrigin))
    throw new Error(
      "Production requires AUTH_USERS_FILE with named users and PUBLIC_ORIGIN with the HTTPS address.",
    );
  if (!isLoopback(host) && (!users || !publicOrigin))
    throw new Error("Remote binding requires named users and PUBLIC_ORIGIN.");
  if (mode === "production" && env.ACCESS_PASSWORD)
    throw new Error(
      "ACCESS_PASSWORD is for local pilot use only. Configure named users for production.",
    );
  if (mode === "production" && !env.DATABASE_PATH)
    throw new Error(
      "Production requires an explicit persistent DATABASE_PATH.",
    );
  const databasePath = path.resolve(
    env.DATABASE_PATH || "./data/inventory.sqlite",
  );
  const backupDir = path.resolve(
    env.BACKUP_DIR || path.join(path.dirname(databasePath), "backups"),
  );
  return {
    mode,
    host,
    port,
    publicOrigin,
    users,
    password: env.ACCESS_PASSWORD,
    databasePath,
    backupDir,
  };
}
