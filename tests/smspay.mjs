// Automatic payment check from the owner's bank SMS (lib/smspay.js). Runs the real server.
// `node tests/smspay.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 4793, TOKEN = "t0ken-for-tests-1234567890";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-smspay-"));
const base = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = spawn(process.execPath, ["server.js"], { cwd: path.resolve(import.meta.dirname, ".."), stdio: "ignore",
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", ANTHROPIC_API_KEY: "", WA_TOKEN: "", ORDER_HOURS: "0-24", RENDER: "", PAY_SMS_TOKEN: TOKEN } });
process.on("exit", () => srv.kill());
for (let i = 0; i < 60; i++) { try { await fetch(`${base}/api/products`); break; } catch { await wait(100); } }

let n = 0, ip = 1;
const ok = (name) => console.log(`ok ${++n} - ${name}`);
const owner = async (method, p, b) => (await fetch(base + p, { method, headers: { "Content-Type": "application/json", "x-owner-key": "k" }, body: b ? JSON.stringify(b) : undefined })).json();
const item = async (name, price, quantity = 1) => {
  const { product } = await owner("POST", "/api/billing/items", { name, price, quantity });
  const f = path.join(dir, "products.json"), all = JSON.parse(fs.readFileSync(f, "utf8"));
  const p = all.find((x) => x.id === product.id); p.image = "/uploads/x.jpg"; delete p.hidden;
  fs.writeFileSync(f, JSON.stringify(all));
  return product.id;
};
const order = async (id, phone) => (await fetch(`${base}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": `10.2.0.${ip++}` },
  body: JSON.stringify({ lines: [{ id }], name: "Aamir", phone, delivery: "pickup" }) })).json();
const sms = (body, { token = TOKEN, type = "application/json" } = {}) => fetch(`${base}/api/pay/sms?t=${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": type }, body })
  .then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const status = async (id) => (await (await fetch(`${base}/api/orders/${id}`)).json()).status;
const inr = (n) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const jacket = await item("Puma jacket", 6600, 3);

// 1. Each order asks for a unique amount a few paise under the price.
const a = await order(jacket, "9876500011"), b = await order(jacket, "9876500012");
assert.equal(a.amount, 6600); assert.ok(a.payExact < 6600 && a.payExact >= 6599.01, `payExact ${a.payExact}`); assert.equal(a.auto, true);
assert.notEqual(a.payExact, b.payExact);
ok("unique paise per order, never more than the price");

// 2. Wrong token: refused, nothing confirmed.
assert.equal((await sms(JSON.stringify({ text: `credited INR ${a.payExact}` }), { token: "nope" })).status, 401);
assert.equal(await status(a.id), "awaiting_payment");
ok("wrong token refused");

// 3. Not a credit, or a credit of another amount: left alone.
assert.equal((await sms(JSON.stringify({ text: `Rs ${a.payExact} debited from your a/c and credited to x@ybl` }))).matched, null);
assert.equal((await sms(JSON.stringify({ text: "Your a/c is credited with INR 6,600.00 by UPI" }))).matched, null);
assert.equal(await status(a.id), "awaiting_payment");
ok("debits and round amounts don't confirm anything");

// 4. The real bank SMS: the right order confirms itself, the bill shows the money received.
const text = `Your A/c XX4567 is credited with INR ${inr(a.payExact)} on 09-11-26 by UPI Ref 4321. -J&K Bank`;
const r = await sms(JSON.stringify({ from: "JK-JKBANK", text }));
assert.equal(r.matched, a.code); assert.equal(r.status, "confirmed");
assert.equal(await status(a.id), "confirmed"); assert.equal(await status(b.id), "awaiting_payment");
const bill = JSON.parse(fs.readFileSync(path.join(dir, "invoices.json"), "utf8")).find((x) => x.order === a.code);
assert.equal(bill.total, a.payExact);
const alert = JSON.parse(fs.readFileSync(path.join(dir, "inbox.json"), "utf8")).at(-1).text;
assert.match(alert, /Paid: ₹6,599\.\d\d reached your bank/); assert.match(alert, new RegExp(`${a.code} confirmed`));
ok("matching credit SMS confirms that order only; bill total = money received; owner told");

// 5. The forwarder retries the same SMS: counted once.
assert.equal((await sms(JSON.stringify({ from: "JK-JKBANK", text }))).why, "seen before");
ok("the same SMS twice counts once");

// 6. Plain-text and form bodies work too (different forwarder apps).
const t2 = `Rs.${b.payExact} credited to your a/c XXXX99997 via UPI`;
assert.equal((await sms(new URLSearchParams({ from: "AX-JKBANK", message: t2 }).toString(), { type: "application/x-www-form-urlencoded" })).matched, b.code);
ok("form-encoded SMS confirms too");

// 7. Owner alert for a new order names the exact amount.
const c = await order(jacket, "9876500013");
const newAlert = JSON.parse(fs.readFileSync(path.join(dir, "inbox.json"), "utf8")).find((x) => x.summary?.ref === c.code)?.text || "";
assert.match(newAlert, /paying exactly \*₹6,599\.\d\d\*/);
ok("owner's new-order alert shows the exact amount");

console.log(`\n${n} passed`);
process.exit(0);
