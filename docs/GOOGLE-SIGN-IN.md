# Open Google sign-in

## Current access status — 2026-09-15

The canonical app URL is **https://iboltscan.com**, with `/sign-in` and `/sign-up` routes. Open the link in a normal Chrome or Safari window if it launches inside an email app. Registration remains open in the same production Clerk instance. Actual email-code delivery, email-code sign-in, and Google sign-in are verified on the new domain. The `/sign-up` UI renders Google and email/password options with verification still enabled. Creating an account for a previously unregistered person has not been tested end to end.

On September 15, `iboltscan.com` was registered through Cloudflare and reports Active. The apex and `www` DNS records are configured, and all five Clerk CNAME records are verified, including all three email records. Clerk now uses the standard Frontend API at `clerk.iboltscan.com`; the Google OAuth callback has been updated for that domain. The migration retains the former `inventory.89.167.10.34.nip.io` host as a redirect to the canonical domain, preserving old inventory links and labels. Redirect checks and the remaining account flows are tracked separately from DNS verification.

At 17:50 UTC, an actual Clerk verification email from the new domain reached the owner's inbox; its received headers showed both SPF and DKIM passing for the new sender. Entering its code completed sign-in at 17:51–17:52 UTC and loaded `https://iboltscan.com/` with **Database connected** and the existing administrator role. A separate Google flow from the canonical sign-in page through **Continue with Google** and the owner's account chooser also returned to the canonical inventory with the same role and connected database. These checks verify actual account authentication, beyond DNS or mail-provider acceptance. No inventory records were written during the checks. The sign-in guidance now offers Google or email instead of the earlier email-unavailable notice.

### Earlier email failure — 2026-09-15

On September 15, the production Clerk **Email Logs** confirmed verification-code bounces with SMTP status `550 5.7.26`: unauthenticated mail from `nip.io` was rejected under that domain's DMARC policy. A new-device notification failed for the same reason, and a recipient suppression entry was present. This is a sender-authentication failure, not evidence of an inventory database or Google OAuth failure.

The earlier same-origin Frontend API proxy made browser authentication requests work but did not authenticate the production sending domain. The controlled domain and verified Clerk mail records address that missing sender configuration, and the owner's successful email-code sign-in confirms delivery through the new sender. For a previously suppressed recipient, inspect Clerk's delivery logs during their next attempt rather than treating another user's receipt as proof that suppression is cleared. Keep email verification and server-side authentication enabled. See Clerk's [email deliverability guide](https://clerk.com/docs/guides/development/troubleshooting/email-deliverability), [proxy documentation](https://clerk.com/docs/guides/dashboard/dns-domains/proxy-fapi), and [Email Logs reference](https://clerk.com/changelog/2026-06-01-email-logs-public-beta).

## Requested behavior

Anyone may create an account through Google and use inventory as an operator. The owner explicitly authorized open registration on September 14, 2026. Clerk still authenticates sessions; administrator-only operations retain their role checks. Shopify remains read-only.

The original live **iBolt Inventory** application (`app_3IsKD3CMwxmMbH8PouoYGILffVW`) has been transferred from Jacob's Personal workspace into Jacob's **Ibolt** Clerk organization. Its existing production instance remains `ins_3IsLFtOtlFlrMvn1Zt946D4yj9O`. Configure this existing application; the transfer preserves the production application's identity rather than replacing its users or inventory URL. Preserve the owner's administrator access.

## Implementation and activation evidence — 2026-09-14

The client now uses Clerk `SignUp` at `/sign-up`, with a normal sign-up link from `/sign-in`. `/accept-invitation` remains supported for existing invitations. Successful authentication returns to a validated inventory screen. Google buttons are supplied by Clerk when its Google connection is enabled; a frontend code change alone cannot enable Google OAuth.

On September 14, the organization transfer completed, production **Access mode: Open** was saved, and the allowlist was disabled. At that checkpoint, the live Clerk environment reported `sign_up.mode = public` and the signup URL was `https://inventory.89.167.10.34.nip.io/sign-up`.

Release **0f97db4** was deployed at 19:20 UTC. The live page shows **Create your inventory account**, an email and password signup form, and the regular Sign in link. The signed-out API returns 401. A verified backup preceded activation, and fingerprints for all six inventory tables matched before and after: 700 products, 17 bins, 19 counts, 1571 audit rows, 4 imports and 116 bin measurements. Environment contents were unchanged. The backup was also verified in the PC's `backups/remote` directory.

`npm run check`, all **42 tests**, and `npm run build` passed locally and on Linux. The six new tests cover token readiness, one refresh after rejection, persistent rejection, missing sessions, mutation retry boundaries, and safe return destinations. A disposable local database loaded the workspace and direct bin-weight route successfully. The public app and privacy pages were checked in a separate static preview.

Google OAuth is **enabled and verified on the live app** as of September 14 Pacific / September 15 UTC. The owner approved Google's API Services: User Data Policy. Google project `iboltscan-oauth-2026` has the **iBOLT Scan production** web client, with audience **External** and publishing status **In production**. Clerk reports Google `enabled = true` and `authenticatable = true`, alongside `sign_up.mode = public`. Only basic identity scopes are requested: `openid`, `userinfo.email`, and `userinfo.profile`. The client credentials are saved in Clerk and are not in the repository or service environment.

At that checkpoint, the exact OAuth callback was `https://inventory.89.167.10.34.nip.io/__clerk/v1/oauth_callback`, with JavaScript origin `https://inventory.89.167.10.34.nip.io`. Public branding pointed to `/about.html` and `/privacy.html`, both verified HTTP 200. Release **e1febb0** added these pages and their links on the sign-in screen. Activation preserved the protected environment and all six inventory-table fingerprints; the service and backup timer remained active. This callback is historical; use the new domain's current Clerk callback for configuration.

An actual Google flow from `/sign-up` linked Jacob's Google account to his existing production user, returned to the live inventory, and preserved his administrator role. Fresh navigation loaded Bin weights and all 116 measurements. A subsequent sign-out/sign-in test exposed nginx's `upstream sent too big header` error on the Clerk callback. The inventory-only `/__clerk` location now uses `proxy_buffer_size 16k`, `proxy_buffers 4 16k`, and `proxy_busy_buffers_size 32k`. Configuration was backed up, `nginx -t` passed, and nginx was gracefully reloaded. A fresh Google sign-in then succeeded and returned directly to `/?view=bin-weights`. No synthetic inventory records were saved. A second person's account creation has not been exercised.

Google displayed **nip.io** in its account chooser during that earlier deployment. Basic Google login worked without requesting sensitive or restricted scopes. The runtime uses `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `/etc/iboltscan/app.env`; the dashboard's generic Next.js `.env.local` snippet is not this Express app's configuration. The former deployment also used `CLERK_PROXY_URL`; the standard `clerk.iboltscan.com` Frontend API replaces that proxy for the new domain.

## Request authentication and recovery

Clerk's signed-in client waits for `getToken()` before calling the inventory API, then sends the token in the `Authorization: Bearer` header. The Express Clerk middleware still verifies the token; inventory roles remain enforced on the server and new users default to `operator`.

A request rejected with HTTP 401 obtains a fresh token using `skipCache: true` and retries once. The server rejects unauthenticated requests before any inventory operation runs. The retry retains the original count request body and idempotency key. Permission errors, conflicts, throttling, server errors, and network failures are not automatically replayed.

If the fresh token is also rejected, or Clerk no longer has a session, the client stops redirecting and opens **Reconnect to inventory**. **Retry connection** checks `/api/status` and reloads inventory data after success while keeping the current form mounted. **Sign out and sign in again** ends the session explicitly; unsaved form entries are discarded by that action. Successful loading restores a validated root inventory destination, including bin-weight and bin links, instead of nesting sign-in URLs inside `returnTo`.

## Clerk and Google configuration

1. In Jacob's **Ibolt** organization, select the transferred **iBolt Inventory** application and its existing production instance identified above. Do not use Gavin's workspace or replace the live instance with the separately created application.
2. Keep production **Access mode** set to **Open** (`public`) and the allowlist disabled. These settings have been saved; do not restore the earlier Waitlist configuration.
3. Enable Google for signup and sign-in. For production, configure a Google OAuth web client with custom credentials. Use only basic identity scopes (`openid`, `email`, `profile`), and copy the exact authorized redirect URI from Clerk into Google Cloud; do not infer it from a hostname.
4. Keep Google's audience **External** and publishing status **In production**, as configured. Avoid adding Gmail, Drive, or other scopes: this app needs only basic sign-in identity.
5. Configure home URL `https://iboltscan.com`, sign-in `/sign-in`, and sign-up `/sign-up`. Use the verified Frontend API domain `clerk.iboltscan.com` for the existing production instance. The protected runtime uses `PUBLIC_ORIGIN=https://iboltscan.com` and the matching Clerk publishable key; leave `CLERK_PROXY_URL` unset for this standard DNS configuration. Store server keys only in `/etc/iboltscan/app.env`; never commit them or put them in client source.
6. Before switching the live release or keys, create a verified inventory backup and preserve the previous release and protected environment for rollback. Existing inventory data is independent of Clerk accounts; preserve database paths and the owner's administrator role. A new Clerk instance requires users to authenticate in that instance, and historical actor IDs remain unchanged.
7. Validate Google sign-in in a standard browser, account creation by a previously unregistered user, direct entry to `/?view=bin-weights`, reload, sign-out and subsequent sign-in. Verify authenticated API access and anonymous rejection without saving synthetic stock counts. Use a disposable database for any inventory mutations during QA.

Clerk documents [Open access mode](https://clerk.com/docs/guides/secure/restricting-access) and [production Google social connections](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google). Google authentication may reject embedded browser/webview sign-in, so use the external browser for the real Google account test.
