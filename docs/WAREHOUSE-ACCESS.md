# Temporary warehouse access

A temporary warehouse link opens the inventory without an account or Clerk sign-in. Anyone holding the full link can read the catalog, set up bins, enter weights, and save physical counts as an operator. Administrators' backup and archive actions remain unavailable. Saved counts require a typed operator name and use `warehouse-link` as their audit actor; the typed name is not a verified account identity.

The owner enables a link by setting both protected service environment values:

```text
WAREHOUSE_ACCESS_TOKEN_SHA256=<SHA-256 of a random 32-byte hexadecimal token>
WAREHOUSE_ACCESS_EXPIRES_AT=<absolute ISO-8601 expiration time>
```

Generate a fresh random token for each activation and give its full HTTPS link only to the intended team: `/warehouse#key=<token>`. Keep the token out of Git, logs, and ordinary deployment notes. The URL fragment stays in the browser rather than HTTP access logs. The entry page exchanges it for a Secure, HttpOnly, SameSite cookie and removes the fragment from browser history. HTTPS and same-origin checks stay enabled.

Every request checks the configured hash and expiration time. The link and its cookies cease working at expiry, including on devices that already opened it. To revoke earlier, clear both environment values and restart only `iboltscan`; to rotate, replace the hash and expiry. No scheduled job is needed. Existing Clerk or named-account configuration remains required for production and is the fallback once temporary access ends.

The **End access on this device** button clears that browser's temporary access cookie. It does not revoke copies of the full link held elsewhere. After access expires, reopen a fresh temporary link or use account sign-in.

Preview and scanner diagnostics save no counts. Continue to save only actual physical inventory. Changes to temporary access must be tested with an isolated database; never save synthetic counts in the operating database.
