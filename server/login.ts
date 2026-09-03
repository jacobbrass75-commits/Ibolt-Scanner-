export function safeReturn(value: unknown) {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !value.startsWith("/login") &&
    !value.startsWith("/api/")
    ? value
    : "/";
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export function loginPage(returnTo: unknown, invalid = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · iBolt Inventory</title><link rel="stylesheet" href="/login.css"></head><body><main><div class="brand">iBolt <span>Inventory</span></div><h1>Sign in to your inventory</h1><p>Scan parts, record weights, and keep your physical counts together.</p>${invalid ? '<p class="error" role="alert">Check your username and password, then try again.</p>' : ""}<form action="/login" method="post"><input type="hidden" name="returnTo" value="${escape(safeReturn(returnTo))}"><label>Username<input name="username" autocomplete="username" required maxlength="64" autofocus></label><label>Password<input type="password" name="password" autocomplete="current-password" required maxlength="256"></label><button type="submit">Sign in</button></form><small>Use your assigned inventory account. Your session lasts up to 8 hours; sign out on shared devices.</small></main></body></html>`;
}
export const loginCss = `*{box-sizing:border-box}body{margin:0;background:#f4f6f9;color:#183042;font:16px system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:100%;max-width:440px;background:white;border:1px solid #dfe5e8;border-radius:16px;padding:36px;box-shadow:0 15px 50px #1730420a}.brand{font-size:24px;font-weight:750;margin-bottom:32px}.brand span{font-weight:400}h1{font-size:25px;line-height:1.25}p{line-height:1.6;color:#5e6d78}label{display:block;font-weight:600;margin:18px 0}input{display:block;width:100%;font:inherit;padding:13px;border:1px solid #c9d3d9;border-radius:7px;margin-top:8px}input:focus{outline:2px solid #72aaa0;outline-offset:2px}button{width:100%;font:inherit;font-weight:650;padding:14px;border:0;border-radius:7px;background:#173042;color:white;cursor:pointer;margin:8px 0 24px}button:hover{background:#284e61}small{color:#65757f;line-height:1.5;display:block}.error{color:#a32525;background:#fff1ef;padding:10px;border-radius:6px}`;
