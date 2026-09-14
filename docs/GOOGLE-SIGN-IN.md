# Open Google sign-in

## Requested behavior

Anyone may create an account through Google and use inventory as an operator. The owner explicitly authorized open registration on September 14, 2026. Clerk still authenticates sessions; administrator-only operations retain their role checks. Shopify remains read-only.

The authentication application must belong to Jacob's **Ibolt** Clerk workspace. Creating that workspace does not move an existing application or change the running server's keys. Preserve the owner's administrator access when configuring or moving the application.

## Implementation and activation status

The client now uses Clerk `SignUp` at `/sign-up`, with a normal sign-up link from `/sign-in`. `/accept-invitation` remains supported for existing invitations. Successful authentication returns to a validated inventory screen. Google buttons are supplied by Clerk when its Google connection is enabled; a frontend code change alone cannot enable Google OAuth.

On September 14, the live production instance `ins_3IsLFtOtlFlrMvn1Zt946D4yj9O` still reported `sign_up.mode = waitlist` and `oauth_google.enabled = false`. Its displayed application name was `iBolt Inventory`, and its sign-up URL was `/accept-invitation`. This instance's workspace ownership was not verified during that check. Browser access was unavailable, so no Clerk dashboard settings or live credentials were changed. The local signup change is pending coordinated activation; Google sign-in and the previously reported sign-in loop are not yet verified as resolved.

Validation for the pending client change: `npm run check`, all 36 existing tests, `npm run build`, and `git diff --check` passed. Live Google OAuth and browser QA remain pending browser access.

## Clerk and Google configuration

1. In Jacob's Ibolt workspace, select or create the intended inventory application. Verify ownership before changing anything. Do not use Gavin's workspace.
2. Set production **Access mode** to **Open** (`public`). Do not add a per-email allowlist.
3. Enable Google for signup and sign-in. For production, configure a Google OAuth web client with custom credentials. Use only basic identity scopes (`openid`, `email`, `profile`), and copy the exact authorized redirect URI from Clerk into Google Cloud; do not infer it from a hostname.
4. Set the Google OAuth application's audience/publishing configuration to allow the intended public Google users. A testing-only audience is insufficient for unrestricted signup.
5. Configure home URL `https://inventory.89.167.10.34.nip.io`, sign-in `/sign-in`, and sign-up `/sign-up`. Keep the same-origin `/__clerk` proxy correctly configured for the selected production instance. Store server keys only in `/etc/iboltscan/app.env`; never commit them or put them in client source.
6. Before switching the live release or keys, create a verified inventory backup and preserve the previous release and protected environment for rollback. Existing inventory data is independent of Clerk accounts; preserve database paths and the owner's administrator role. A new Clerk instance requires users to authenticate in that instance, and historical actor IDs remain unchanged.
7. Validate Google sign-in in a standard browser, account creation by a previously unregistered user, direct entry to `/?view=bin-weights`, reload, sign-out and subsequent sign-in. Verify authenticated API access and anonymous rejection without saving synthetic stock counts. Use a disposable database for any inventory mutations during QA.

Clerk documents [Open access mode](https://clerk.com/docs/guides/secure/restricting-access) and [production Google social connections](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google). Google authentication may reject embedded browser/webview sign-in, so use the external browser for the real Google account test.
