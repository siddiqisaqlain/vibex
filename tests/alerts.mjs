// Order/enquiry alerts outside WhatsApp's 24-hour window. Runs the real server against a fake
// Meta Graph API. `node tests/alerts.mjs`
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const OWNER = "919000000002";
const SECRET = "test-secret";
const PORT = 4791;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-alerts-"));

let windowOpen = false;            // has the owner messaged the bot in the last 24 h?
const sent = [];                   // every message the server asked Meta to send
const graph = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const body = b ? JSON.parse(b) : {};
    if (req.url.endsWith("/messages")) {
      sent.push(body);
      if (body.type !== "template" && !windowOpen) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }));
      }
      return res.end(JSON.stringify({ messages: [{ id: "wamid.x" }] }));
    }
    res.end("{}");
  });
});
await new Promise((r) => graph.listen(0, "127.0.0.1", r));

const srv = spawn(process.execPath, ["server.js"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OWNER_KEY: "k", WA_TOKEN: "t", WA_PHONE_ID: "123", WA_APP_SECRET: SECRET,
    OWNER_WHATSAPP: OWNER, WA_GRAPH_URL: `http://127.0.0.1:${graph.address().port}`, ANTHROPIC_API_KEY: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) { try { await fetch(`${base}/api/products`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const ok = (name) => console.log(`ok ${++n} - ${name}`);

try {
  const product = (await (await fetch(`${base}/api/products`)).json()).find((p) => p.status !== "sold");

  // 1. Enquiry while the owner hasn't messaged for 24 h: free-form refused -> template sent.
  const r = await fetch(`${base}/api/enquiry`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId: product.id, name: "Aamir\nKhan", phone: "9876543210", note: "Is it still there?" }) });
  assert.equal(r.status, 200);
  await wait(400);
  const tpl = sent.find((m) => m.type === "template");
  assert.ok(tpl, "a template was sent");
  assert.equal(tpl.to, OWNER);
  assert.equal(tpl.template.name, "website_alert");
  const params = tpl.template.components[0].parameters.map((p) => p.text);
  assert.equal(params.length, 3);
  assert.equal(params[0], "Vibe X");
  assert.equal(params[1], "enquiry");
  assert.match(params[2], /^EQ[A-Z0-9]{1,6}$/, `reference: ${params[2]}`);
  for (const p of params) assert.ok(!/[\n\t]/.test(p));
  ok("outside the 24 h window, the owner gets the approved template: Vibe X / enquiry / reference");

  const held = JSON.parse(fs.readFileSync(path.join(dir, "wa-alerts.json"), "utf8"));
  assert.equal(held[OWNER].length, 1);
  assert.match(held[OWNER][0].text, /Enquiry from the website/);
  ok("the full alert is kept on the disk until the owner replies");

  // 2. Owner taps "Show details": the window opens, the full alert is delivered, no other reply.
  windowOpen = true;
  sent.length = 0;
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "wamid.btn1", from: OWNER, type: "button", button: { text: "Show details", payload: "Show details" } }] } }] }] });
  const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  const w = await fetch(`${base}/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw });
  assert.equal(w.status, 200);
  await wait(400);
  const texts = sent.map((m) => m.text?.body || m.image?.caption || "");
  assert.ok(texts.some((t) => /Enquiry from the website/.test(t) && /Aamir/.test(t)), `full alert delivered: ${JSON.stringify(texts)}`);
  assert.ok(!texts.some((t) => /Send a product photo|Something went wrong/.test(t)), "the button isn't treated as a product post");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "wa-alerts.json"), "utf8")), {});
  ok("tapping Show details delivers the held alert and nothing else");

  // 3. Inside the window: alerts go out as normal messages, no template.
  sent.length = 0;
  await fetch(`${base}/api/enquiry`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId: product.id, name: "Sana", phone: "9876543211" }) });
  await wait(400);
  assert.ok(sent.length >= 1 && !sent.some((m) => m.type === "template"));
  ok("inside the 24 h window, alerts are sent normally without the template");

  console.log(`\nall ${n} checks passed`);
} catch (e) {
  console.error(e); console.error("--- server log ---\n" + log); process.exitCode = 1;
} finally {
  srv.kill(); graph.close(); fs.rmSync(dir, { recursive: true, force: true });
}
