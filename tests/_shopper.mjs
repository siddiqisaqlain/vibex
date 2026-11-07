// Website orders need a signed-in customer. Tests sign one in the way a phone does: ask for a
// WhatsApp code, "send" it (WA_LOGIN_DEV lets a local server pretend the message arrived), collect
// the session cookie. Returns "vxs=..." for a Cookie header.
export async function shopperCookie(base, phone = "9876543210") {
  const j = (r) => r.json();
  const st = await fetch(`${base}/api/account/wa/start`, { method: "POST", headers: { "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.1` } }).then(j);
  if (!st.code) throw new Error(`no login code: ${JSON.stringify(st)} (is WA_LOGIN_DEV set?)`);
  await fetch(`${base}/api/account/wa/dev-send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: `91${phone}`, text: st.text }) });
  const r = await fetch(`${base}/api/account/wa/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pending: st.pending }) });
  const c = (r.headers.get("set-cookie") || "").split(";")[0];
  if (!/^vxs=[a-f0-9]{64}$/.test(c)) throw new Error("sign-in failed");
  return c;
}
