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
export type ClerkConfig = {
  publishableKey: string;
  secretKey: string;
  proxyUrl?: string;
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
  const clerkPublishableKey = env.CLERK_PUBLISHABLE_KEY?.trim();
  const clerkSecretKey = env.CLERK_SECRET_KEY?.trim();
  if (Boolean(clerkPublishableKey) !== Boolean(clerkSecretKey))
    throw new Error(
      "CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY must be configured together.",
    );
  let clerkProxyUrl: string | undefined;
  if (env.CLERK_PROXY_URL) {
    const url = new URL(env.CLERK_PROXY_URL);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname === "/"
    )
      throw new Error(
        "CLERK_PROXY_URL must be an HTTPS URL with a non-root path and without a query or credentials.",
      );
    if (publicOrigin && url.origin !== publicOrigin)
      throw new Error("CLERK_PROXY_URL must use the PUBLIC_ORIGIN host.");
    clerkProxyUrl = url.origin + url.pathname.replace(/\/+$/, "");
  }
  const clerk =
    clerkPublishableKey && clerkSecretKey
      ? {
          publishableKey: clerkPublishableKey,
          secretKey: clerkSecretKey,
          proxyUrl: clerkProxyUrl,
        }
      : undefined;
  if (clerkProxyUrl && !clerk)
    throw new Error("CLERK_PROXY_URL requires Clerk authentication keys.");
  if (users && clerk)
    throw new Error(
      "Configure either Clerk or AUTH_USERS_FILE, not both authentication systems.",
    );
  if (mode === "production" && ((!users && !clerk) || !publicOrigin))
    throw new Error(
      "Production requires Clerk or AUTH_USERS_FILE authentication and PUBLIC_ORIGIN with the HTTPS address.",
    );
  if (!isLoopback(host) && ((!users && !clerk) || !publicOrigin))
    throw new Error(
      "Remote binding requires authentication and PUBLIC_ORIGIN.",
    );
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
    clerk,
    password: env.ACCESS_PASSWORD,
    databasePath,
    backupDir,
  };
}
