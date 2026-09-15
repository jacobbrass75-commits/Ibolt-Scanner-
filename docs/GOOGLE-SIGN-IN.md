# Open Google sign-in

## Requested behavior

Anyone may create an account through Google and use inventory as an operator. The owner explicitly authorized open registration on September 14, 2026. Clerk still authenticates sessions; administrator-only operations retain their role checks. Shopify remains read-only.

The original live **iBolt Inventory** application (`app_3IsKD3CMwxmMbH8PouoYGILffVW`) has been transferred from Jacob's Personal workspace into Jacob's **Ibolt** Clerk organization. Its existing production instance remains `ins_3IsLFtOtlFlrMvn1Zt946D4yj9O`. Configure this existing application; the transfer preserves the production application's identity rather than replacing its users or inventory URL. Preserve the owner's administrator access.

## Implementation and activation status

The client now uses Clerk `SignUp` at `/sign-up`, with a normal sign-up link from `/sign-in`. `/accept-invitation` remains supported for existing invitations. Successful authentication returns to a validated inventory screen. Google buttons are supplied by Clerk when its Google connection is enabled; a frontend code change alone cannot enable Google OAuth.

On September 14, the organization transfer completed, production **Access mode: Open** was saved, and the allowlist was disabled. The live Clerk environment reports `sign_up.mode = public` and the signup URL is `https://inventory.89.167.10.34.nip.io/sign-up`.

Release **0f97db4** was deployed at 19:20 UTC. The live page shows **Create your inventory account**, an email and password signup form, and the regular Sign in link. The signed-out API returns 401. A verified backup preceded activation, and fingerprints for all six inventory tables matched before and after: 700 products, 17 bins, 19 counts, 1571 audit rows, 4 imports and 116 bin measurements. Environment contents were unchanged. The backup was also verified in the PC's `backups/remote` directory.

`npm run check`, all **42 tests**, and `npm run build` passed locally and on Linux. The six new tests cover token readiness, one refresh after rejection, persistent rejection, missing sessions, mutation retry boundaries, and safe return destinations. A disposable local database loaded the workspace and direct bin-weight route successfully. The public app and privacy pages were checked in a separate static preview.

Google OAuth is **enabled and verified on the live app** as of September 14 Pacific / September 15 UTC. The owner approved Google's API Services: User Data Policy. Google project `iboltscan-oauth-2026` has the **iBOLT Scan production** web client, with audience **External** and publishing status **In production**. Clerk reports Google `enabled = true` and `authenticatable = true`, alongside `sign_up.mode = public`. Only basic identity scopes are requested: `openid`, `userinfo.email`, and `userinfo.profile`. The client credentials are saved in Clerk and are not in the repository or service environment.

The exact OAuth callback is `https://inventory.89.167.10.34.nip.io/__clerk/v1/oauth_callback`, with JavaScript origin `https://inventory.89.167.10.34.nip.io`. Public branding points to `/about.html` and `/privacy.html`, both verified HTTP 200. Release **e1febb0** added these pages and their links on the sign-in screen. Activation preserved the protected environment and all six inventory-table fingerprints; the service and backup timer remained active.

An actual Google flow from `/sign-up` linked Jacob's Google account to his existing production user, returned to the live inventory, and preserved his administrator role. Fresh navigation loaded Bin weights and all 116 measurements. A subsequent sign-out/sign-in test exposed nginx's `upstream sent too big header` error on the Clerk callback. The inventory-only `/__clerk` location now uses `proxy_buffer_size 16k`, `proxy_buffers 4 16k`, and `proxy_busy_buffers_size 32k`. Configuration was backed up, `nginx -t` passed, and nginx was gracefully reloaded. A fresh Google sign-in then succeeded and returned directly to `/?view=bin-weights`. No synthetic inventory records were saved. A second person's account creation has not been exercised.

Google currently displays **nip.io** in its account chooser because the app uses that hostname and custom brand verification has not been completed. The basic Google login works without requesting sensitive or restricted scopes. A custom domain and verified display branding are separate follow-up work, not prerequisites for the verified login. The existing runtime uses `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_PROXY_URL` in `/etc/iboltscan/app.env`; the dashboard's generic Next.js `.env.local` snippet is not this Express app's configuration.

## Request authentication and recovery

Clerk's signed-in client waits for `getToken()` before calling the inventory API, then sends the token in the `Authorization: Bearer` header. The Express Clerk middleware still verifies the token; inventory roles remain enforced on the server and new users default to `operator`.

A request rejected with HTTP 401 obtains a fresh token using `skipCache: true` and retries once. The server rejects unauthenticated requests before any inventory operation runs. The retry retains the original count request body and idempotency key. Permission errors, conflicts, throttling, server errors, and network failures are not automatically replayed.

If the fresh token is also rejected, or Clerk no longer has a session, the client stops redirecting and opens **Reconnect to inventory**. **Retry connection** checks `/api/status` and reloads inventory data after success while keeping the current form mounted. **Sign out and sign in again** ends the session explicitly; unsaved form entries are discarded by that action. Successful loading restores a validated root inventory destination, including bin-weight and bin links, instead of nesting sign-in URLs inside `returnTo`.

## Clerk and Google configuration

1. In Jacob's **Ibolt** organization, select the transferred **iBolt Inventory** application and its existing production instance identified above. Do not use Gavin's workspace or replace the live instance with the separately created application.
2. Keep production **Access mode** set to **Open** (`public`) and the allowlist disabled. These settings have been saved; do not restore the earlier Waitlist configuration.
3. Enable Google for signup and sign-in. For production, configure a Google OAuth web client with custom credentials. Use only basic identity scopes (`openid`, `email`, `profile`), and copy the exact authorized redirect URI from Clerk into Google Cloud; do not infer it from a hostname.
4. Keep Google's audience **External** and publishing status **In production**, as configured. Avoid adding Gmail, Drive, or other scopes: this app needs only basic sign-in identity.
5. Configure home URL `https://inventory.89.167.10.34.nip.io`, sign-in `/sign-in`, and sign-up `/sign-up`. Keep the same-origin `/__clerk` proxy correctly configured for the selected production instance. Store server keys only in `/etc/iboltscan/app.env`; never commit them or put them in client source.
6. Before switching the live release or keys, create a verified inventory backup and preserve the previous release and protected environment for rollback. Existing inventory data is independent of Clerk accounts; preserve database paths and the owner's administrator role. A new Clerk instance requires users to authenticate in that instance, and historical actor IDs remain unchanged.
7. Validate Google sign-in in a standard browser, account creation by a previously unregistered user, direct entry to `/?view=bin-weights`, reload, sign-out and subsequent sign-in. Verify authenticated API access and anonymous rejection without saving synthetic stock counts. Use a disposable database for any inventory mutations during QA.

Clerk documents [Open access mode](https://clerk.com/docs/guides/secure/restricting-access) and [production Google social connections](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google). Google authentication may reject embedded browser/webview sign-in, so use the external browser for the real Google account test.
