// Customers must only ever see the shop's domain, never the host's own address.
// Runs the real server the way Render does. `node tests/domain.mjs`
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 4792;
const HOST = "vibex-pwpg.onrender.com";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-domain-"));
fs.writeFileSync(path.join(dir, "products.json"), JSON.stringify([{ id: "p1", code: "A1", name: "Blue jacket", price: 1000, quantity: 3, status: "available", image: "/uploads/a.jpg", images: [] }]));

const call = (pathname, { host = HOST, method = "GET", body, headers = {} } = {}) => new Promise((ok, no) => {
  const r = http.request({ port: PORT, path: pathname, method, headers: { Host: host, ...headers } }, (res) => {
    let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => ok({ status: res.statusCode, location: res.headers.location, body: b }));
  });
  r.on("error", no); if (body) r.write(body); r.end();
});

async function server(env) {
  const srv = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT, DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "", ANTHROPIC_API_KEY: "", PUBLIC_URL: "", RENDER: "", RENDER_EXTERNAL_URL: "", ...env }, stdio: "ignore" });
  for (let i = 0; i < 80; i++) { try { await call("/api/products", { host: "localhost" }); return srv; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error("server did not start");
}
const stop = (srv) => new Promise((r) => { srv.once("exit", r); srv.kill(); });

let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } };

// Render's own address is set and PUBLIC_URL has gone missing: the worst case.
let srv = await server({ RENDER: "true", RENDER_EXTERNAL_URL: `https://${HOST}` });
for (const [from, to] of [["/", "/"], ["/billing?key=k", "/billing?key=k"], ["/bill/abc?size=80", "/bill/abc?size=80"], ["/shop.css", "/shop.css"]])
  await check(`redirect ${from}`, async () => { const r = await call(from); assert.equal(r.status, 301); assert.equal(r.location, "https://vibexindia.com" + to); });
await check("HEAD redirects too", async () => assert.equal((await call("/", { method: "HEAD" })).status, 301));
await check("health check still answers", async () => assert.equal((await call("/api/products")).status, 200));
await check("WhatsApp router's webhook is not redirected", async () => assert.notEqual((await call("/webhook", { method: "POST", body: "{}" })).status, 301));
await check("webhook GET is not redirected", async () => assert.notEqual((await call("/webhook?hub.mode=x")).status, 301));
await check("the shop's domain is not redirected", async () => assert.equal((await call("/", { host: "vibexindia.com" })).status, 200));

const bill = await call("/api/billing/invoices", { host: "vibexindia.com", method: "POST", headers: { "x-owner-key": "k", "Content-Type": "application/json" }, body: JSON.stringify({ lines: [{ productId: "p1", qty: 1, price: 1000 }], charges: [], customer: { name: "", phone: "" }, payment: "cash" }) });
const id = JSON.parse(bill.body).invoice?.id;
await check("bill was made", async () => assert.ok(id, bill.body));
const pages = ["/", "/billing", "/p/p1", `/bill/${id}`, `/bill/${id}?size=80`, "/config.js", "/api/products"];
for (const pg of pages) await check(`no host address on ${pg}`, async () => { const r = await call(pg, { host: "vibexindia.com" }); assert.equal(r.status, 200, pg); assert.ok(!/onrender/i.test(r.body), "found in response"); });
await check("share preview names the domain", async () => assert.match((await call("/p/p1", { host: "vibexindia.com" })).body, /https:\/\/vibexindia\.com/));
await check("bill page names the domain", async () => assert.match((await call(`/bill/${id}`, { host: "vibexindia.com" })).body, /vibexindia\.com/));
await stop(srv);

// PUBLIC_URL set, as it is live.
srv = await server({ RENDER: "true", RENDER_EXTERNAL_URL: `https://${HOST}`, PUBLIC_URL: "https://vibexindia.com/" });
await check("PUBLIC_URL redirect has no double slash", async () => assert.equal((await call("/billing")).location, "https://vibexindia.com/billing"));
await stop(srv);

// Running on the laptop: nothing redirects.
srv = await server({});
await check("local run does not redirect", async () => assert.equal((await call("/", { host: "localhost:4792" })).status, 200));
await stop(srv);

// A PUBLIC_URL still on the host's address must not redirect to itself forever.
srv = await server({ RENDER: "true", PUBLIC_URL: `https://${HOST}` });
await check("no redirect loop", async () => assert.equal((await call("/")).status, 200));
await stop(srv);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`domain: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
