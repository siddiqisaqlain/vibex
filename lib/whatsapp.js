// Real WhatsApp, through Meta's official WhatsApp Cloud API (no unofficial libraries).
//
// Settings (host environment or .env):
//   WA_TOKEN         access token for the WhatsApp app (a permanent System User token for real use)
//   WA_PHONE_ID      the bot number's "Phone number ID" (not the phone number itself)
//   WA_VERIFY_TOKEN  any secret word; type the same word in Meta's webhook setup
//   WA_APP_SECRET    the Meta app's App Secret; proves each webhook call really came from Meta
//   OWNER_WHATSAPP   the shop owner's number(s), with country code, e.g. 919876543210 (comma-separated for more than one)
//   GRAPH_VERSION    optional, default below
//
// Only the owner's numbers can post or change stock. Anyone else who messages the bot number
// gets one polite line pointing them to the shop.
//
// One bot number for several shops (only owners ever message it). The server that receives
// Meta's webhook is the "hub"; other shops' messages are passed on to their own servers:
//   WA_SHOP_KEY      short name of this shop for the "shop" command, e.g. dslr
//   WA_SHOPS         the other shops: key|Name|https://their-site|owner1,owner2  (several: separate with ;)
//                    e.g. vibex|Vibe X|https://vibexindia.com|919876543210
// A number that owns several shops (e.g. the agency's) picks one with "shop vibex" / "shop dslr";
// "shop" alone shows the current one. A shop behind the hub needs the same WA_* settings
// (minus WA_APP_ID / WA_WABA_ID) and its own OWNER_WHATSAPP.

const crypto = require("crypto");
const fs = require("fs");
const { writeJson } = require("./jsonstore");

// WA_GRAPH_URL only for tests (a fake Meta server); leave it unset.
const GRAPH = () => `${process.env.WA_GRAPH_URL || "https://graph.facebook.com"}/${process.env.GRAPH_VERSION || "v25.0"}`;
const digits = (s) => String(s || "").replace(/\D/g, "");
const owners = () => String(process.env.OWNER_WHATSAPP || "").split(",").map(digits).filter(Boolean);

const enabled = () => Boolean(process.env.WA_TOKEN && process.env.WA_PHONE_ID && process.env.WA_APP_SECRET && owners().length);
const isOwnerNumber = (from) => owners().includes(digits(from));

// GET /webhook: Meta's one-time check when you save the webhook URL.
function verify(url) {
  const ok = url.searchParams.get("hub.mode") === "subscribe" &&
    process.env.WA_VERIFY_TOKEN &&
    url.searchParams.get("hub.verify_token") === process.env.WA_VERIFY_TOKEN;
  return ok ? String(url.searchParams.get("hub.challenge") || "") : null;
}

// Every POST is signed by Meta with the App Secret. Unsigned or wrongly signed calls are dropped.
function signatureOk(raw, header) {
  const secret = process.env.WA_APP_SECRET;
  if (!secret || !header || !String(header).startsWith("sha256=")) return false;
  const want = Buffer.from("sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(String(header));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

async function graph(pathname, init = {}) {
  const res = await fetch(`${GRAPH()}/${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`WhatsApp API ${res.status}: ${data.error?.message || "unknown error"}`);
    err.code = data.error?.code;
    throw err;
  }
  return data;
}

// A photo sent on WhatsApp arrives as a media id: look up its short-lived URL, download it
// (the download needs the token too), and hand it on as a data URL like the demo chat does.
// Anything over 16 MB is refused before it is turned into text (base64 makes it a third bigger).
const MAX_MEDIA = 16 * 1024 * 1024;
const tooBig = () => Object.assign(new Error("media over 16 MB"), { tooBig: true });
async function downloadMedia(id) {
  const meta = await graph(encodeURIComponent(id));
  if (Number(meta.file_size) > MAX_MEDIA) throw tooBig();
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` } });
  if (!res.ok) throw new Error(`media download ${res.status}`);
  if (Number(res.headers.get("content-length")) > MAX_MEDIA) throw tooBig();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_MEDIA) throw tooBig();
  const mime = String(meta.mime_type || res.headers.get("content-type") || "image/jpeg").split(";")[0];
  return `data:${mime};base64,${buf.toString("base64")}`;
}

const sendRaw = (to, payload) =>
  graph(`${process.env.WA_PHONE_ID}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: digits(to), ...payload }),
  });

const sendText = (to, text) => sendRaw(to, { type: "text", text: { body: String(text).slice(0, 4096), preview_url: false } });

// Reply buttons: up to 3, titles up to 20 characters, message body up to 1024 characters.
// A longer message goes as plain text first, then a short line carries the buttons.
// photo (optional, public https link) shows above the text, so the owner sees which item it's about.
async function sendReply(to, text, buttons, list, photo) {
  const pic = /^https:\/\//.test(photo || "") ? photo : null;
  if (list && list.rows && list.rows.length) return sendList(to, text, list);
  if (!buttons || !buttons.length) return pic ? sendImage(to, pic, text) : sendText(to, text);
  let body = String(text);
  if (body.length > 1024) { await sendText(to, body); body = "Post it on the website?"; }
  return sendRaw(to, {
    type: "interactive",
    interactive: {
      type: "button",
      ...(pic ? { header: { type: "image", image: { link: pic } } } : {}),
      body: { text: body },
      // Buttons may be { id, title } or plain strings (the title doubles as the id).
      action: { buttons: buttons.slice(0, 3).map((b) => (typeof b === "string" ? { id: b, title: b } : b))
        .map((b) => ({ type: "reply", reply: { id: String(b.id).slice(0, 256), title: String(b.title).slice(0, 20) } })) },
    },
  });
}

// A tap-to-choose menu: { button, rows: [{ id, title, description? }] }, up to 10 rows,
// titles up to 24 characters, descriptions up to 72. The row's id comes back as the reply.
async function sendList(to, text, list) {
  let body = String(text);
  if (body.length > 1024) { await sendText(to, body); body = "Choose one:"; }
  return sendRaw(to, {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: String(list.button || "Choose").slice(0, 20),
        sections: [{ title: "Choose one", rows: list.rows.slice(0, 10).map((r) => ({
          id: String(r.id || r.title).slice(0, 200), title: String(r.title).slice(0, 24),
          ...(r.description ? { description: String(r.description).slice(0, 72) } : {}),
        })) }],
      },
    },
  });
}

// Photo + caption (captions max 1024). The photo must be on a public https address.
function sendImage(to, link, caption) {
  return sendRaw(to, { type: "image", image: { link, caption: String(caption || "").slice(0, 1024) } });
}

// Turns one incoming WhatsApp message into the shape ownerMessage() takes.
async function toOwnerMessage(m) {
  switch (m.type) {
    case "text": return { text: m.text?.body || "" };
    case "image": return { text: m.image?.caption || "", image: await downloadMedia(m.image.id) };
    case "interactive": return { text: m.interactive?.button_reply?.title || m.interactive?.list_reply?.id || m.interactive?.list_reply?.title || "" };
    case "button": return { text: m.button?.text || "" };
    // Not downloaded: the shop can only post photos, and ownerMessage() says so.
    case "video": return { text: m.video?.caption || "", unsupported: "video" };
    case "document":
      if (/^image\//.test(m.document?.mime_type || "")) return { text: m.document?.caption || "", image: await downloadMedia(m.document.id) };
      return null;
    default: return null; // stickers, voice notes, locations...
  }
}

// ---- Several shops on one bot number ----
const remoteShops = () => String(process.env.WA_SHOPS || "").split(";").map((x) => x.trim()).filter(Boolean).map((x) => {
  const [key, name, url, nums] = x.split("|").map((y) => (y || "").trim());
  return { key: key.toLowerCase(), name: name || key, url: (url || "").replace(/\/$/, ""), owners: String(nums || "").split(",").map(digits).filter(Boolean) };
}).filter((x) => x.key && /^https?:\/\//.test(x.url) && x.owners.length);

// The shops this number may post to: this one first (if it's an owner here), then the others.
function shopsFor(from, local) {
  const list = isOwnerNumber(from) ? [{ key: local.key, name: local.name, url: null }] : [];
  for (const r of remoteShops()) if (r.owners.includes(from)) list.push(r);
  return list;
}

// Which shop each multi-shop number is posting to right now (kept in a small file).
let choices = null;
function choiceOf(from, file) {
  if (!choices) { try { choices = JSON.parse(fs.readFileSync(file, "utf8")); } catch { choices = {}; } }
  return choices[from];
}
function setChoice(from, key, file) {
  choiceOf(from, file);
  choices[from] = key;
  if (file) try { fs.writeFileSync(file, JSON.stringify(choices)); } catch { /* fine: kept in memory */ }
}

// Passes Meta's original signed body on to another shop's server, which checks the signature itself.
async function forward(shop, raw, sig) {
  try {
    const res = await fetch(`${shop.url}/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body: raw });
    console.log(`WhatsApp: passed on to ${shop.name} (${res.status})`);
  } catch (e) {
    console.error(`WhatsApp: couldn't reach ${shop.name}: ${e.message}`);
  }
}

// Handles one verified webhook body. Messages from the same person run one after another
// (several photos in a row must queue in order); Meta's retries are ignored by message id.
// raw + sig (the body as Meta sent it) are needed only to pass messages on to other shops.
// Message ids already handled. Kept on the disk (DATA_DIR/wa-seen.json, 48 h), so a retry Meta sends
// after a restart is still ignored: "sold 4795" must never sell twice. An id is written down BEFORE
// its job runs; losing a message in a crash is safer than selling the same piece again.
const SEEN_MS = 48 * 3600e3;
let seenIdsFile = null, seen = null;
function setSeenFile(file) { seenIdsFile = file; seen = null; }
function seenIds() {
  if (seen) return seen;
  seen = new Map();
  if (!seenIdsFile) return seen;
  try {
    const cut = Date.now() - SEEN_MS;
    for (const [id, t] of Object.entries(JSON.parse(fs.readFileSync(seenIdsFile, "utf8")))) if (t > cut) seen.set(id, t);
  } catch (e) { if (e.code !== "ENOENT") console.error(`WhatsApp: ${seenIdsFile} unreadable, starting a new one: ${e.message}`); }
  return seen;
}
function saveSeen() {
  if (!seenIdsFile) return;
  try { writeJson(seenIdsFile, Object.fromEntries(seen)); } catch (e) { console.error(`WhatsApp: couldn't save message ids: ${e.message}`); }
}
const lanes = new Map();
const albums = new Map(); // photos from one number still arriving: { msgs, last }
// On SIGTERM, drain() wakes every album that is still waiting for more photos, so it runs now.
let draining = false;
const wakers = new Set();
const nap = (ms) => new Promise((resolve) => {
  const done = () => { clearTimeout(t); wakers.delete(done); resolve(); };
  const t = setTimeout(done, ms);
  wakers.add(done);
});
// Runs one job after the previous ones from the same number.
function queueJob(from, shops, job, id = "album") {
  const lane = (lanes.get(from) || Promise.resolve()).then(job).catch(async (e) => {
    console.error(`WhatsApp message ${id}: ${e.message}`);
    const say = e.tooBig ? "⚠️ That file is too big (over 16 MB). Please send it as a photo, not a file or video." : "⚠️ Something went wrong on my side. Please send that again in a minute.";
    if (shops.length) await sendText(from, say).catch(() => {});
  });
  lanes.set(from, lane);
  lane.finally(() => { if (lanes.get(from) === lane) lanes.delete(from); });
}
// Before a restart: albums stop waiting, then every running or queued job gets up to `ms` to finish.
async function drain(ms = 8000) {
  draining = true;
  for (const w of [...wakers]) w();
  const until = Date.now() + ms;
  while (lanes.size && Date.now() < until) {
    await Promise.race([Promise.allSettled([...lanes.values()]), new Promise((r) => setTimeout(r, Math.max(0, until - Date.now())))]);
  }
  return lanes.size; // jobs still unfinished
}
function handleWebhook(payload, { ownerMessage, shopName, shopUrl, shopKey, choiceFile }, raw, sig) {
  const now = Date.now();
  const local = { key: String(shopKey || process.env.WA_SHOP_KEY || shopName.split(/\s+/)[0]).toLowerCase(), name: shopName };
  const forwarded = new Set();
  const ids = seenIds();
  let fresh = false;
  for (const [id, t] of ids) if (now - t > SEEN_MS) { ids.delete(id); fresh = true; }
  const todo = [];
  for (const entry of payload.entry || []) for (const change of entry.changes || []) for (const m of change.value?.messages || []) {
    if (!m.id || ids.has(m.id)) continue;
    ids.set(m.id, now);
    todo.push(m);
  }
  if (todo.length || fresh) saveSeen(); // on the disk before any job starts
  for (const m of todo) {
    const from = digits(m.from);
    const shops = shopsFor(from, local);
    if (shops.length) noteIn(from); // an owner wrote: the 24 h window is open again
    console.log(`WhatsApp in: ${m.type} from ${from.slice(0, 4)}…${shops.length ? ` (owner: ${shops.map((x) => x.key).join(", ")})` : ""}`);
    const text = m.type === "text" ? String(m.text?.body || "") : "";
    // Photos for this shop are gathered: several sent together become one batch.
    const isPhoto = m.type === "image" || (m.type === "document" && /^image\//.test(m.document?.mime_type || ""));
    const here = shops.find((x) => x.key === choiceOf(from, choiceFile)) || shops[0];
    if (isPhoto && here && !here.url) {
      const open = albums.get(from);
      if (open) { open.msgs.push(m); open.last = Date.now(); continue; } // joins the album already waiting
      const album = { msgs: [m], last: Date.now() };
      albums.set(from, album);
      queueJob(from, shops, async () => {
        const quiet = Number(process.env.WA_ALBUM_MS) || 6000; // wait until the photos stop coming
        while (!draining && Date.now() - album.last < quiet) await nap(quiet - (Date.now() - album.last) + 20);
        albums.delete(from);
        await deliverQueued(from);
        let big = 0;
        const got = (await Promise.all(album.msgs.map((x) => toOwnerMessage(x).catch((e) => { if (e.tooBig) big++; console.error(`WhatsApp photo download: ${e.message}`); return null; })))).filter(Boolean);
        const total = album.msgs.length, failed = total - got.length;
        if (!got.length) {
          await sendText(from, big === total ? "⚠️ That file is too big (over 16 MB). Please send it as a photo, not a file." : `⚠️ ${total === 1 ? "That photo" : `None of the ${total} photos`} couldn't be downloaded. Please send ${total === 1 ? "it" : "them"} again.`);
          return;
        }
        console.log(`WhatsApp: ${got.length} photo${got.length > 1 ? "s" : ""} together${failed ? ` (${failed} failed to download)` : ""}`);
        const out = await ownerMessage(got.length === 1 ? got[0] : { photos: got });
        // The owner must know which photos never arrived, or they silently go missing.
        const lost = failed ? `⚠️ ${failed} of ${total} photos couldn't be downloaded${big ? " (too big, over 16 MB)" : ""}, please resend those.\n\n` : "";
        await sendReply(from, lost + (out.reply || out.error || "Something went wrong."), out.buttons, out.list, out.photo);
      });
      continue;
    }
    const pick = /^\s*(?:shop|switch)(?:\s+(\S+))?\s*$/i.exec(text);
    const job = async () => {
      if (!shops.length) {
        await sendText(from, `Hi! This number only updates the ${shopName} website. See everything for sale at ${shopUrl}`);
        return;
      }
      // "shop" / "shop vibex": choose which shop this number posts to.
      if (pick && (shops.length > 1 || !pick[1])) {
        const want = (pick[1] || "").toLowerCase();
        const hit = want && shops.find((x) => x.key === want || x.name.toLowerCase().replace(/\s+/g, "") === want);
        if (hit) setChoice(from, hit.key, choiceFile);
        const cur = shops.find((x) => x.key === choiceOf(from, choiceFile)) || shops[0];
        const others = shops.filter((x) => x !== cur).map((x) => `*shop ${x.key}*`).join(" or ");
        await sendText(from, want && !hit
          ? `I don't know a shop called “${pick[1]}”. Your shops: ${shops.map((x) => `*${x.key}* (${x.name})`).join(", ")}.`
          : `🏪 Now posting to *${cur.name}*.${others ? `\nTo switch, send ${others}.` : ""}`);
        return;
      }
      const target = shops.find((x) => x.key === choiceOf(from, choiceFile)) || shops[0];
      if (target.url) {
        if (!raw || !sig) throw new Error("can't pass on: no original body");
        if (!forwarded.has(target.key)) { forwarded.add(target.key); await forward(target, raw, sig); }
        return;
      }
      const held = await deliverQueued(from);
      if (m.type === "button" && /show details/i.test(m.button?.text || "")) {
        if (!held) await sendText(from, "✅ Nothing waiting: you've seen everything. Open your shop screen for the full list.");
        return;
      }
      const msg = await toOwnerMessage(m);
      if (!msg) { await sendText(from, "📷 Send a product photo with a caption, or a command like *sold a7iii*. Send *help* for the list."); return; }
      const out = await ownerMessage(msg);
      await sendReply(from, out.reply || out.error || "Something went wrong.", out.buttons, out.list, out.photo);
      console.log(`WhatsApp out: reply sent to ${from.slice(0, 4)}…`);
    };
    queueJob(from, shops, job, m.id);
  }
}

// Enquiries and orders from the website go to every owner number.
// WhatsApp only allows free-form messages within 24 hours of the owner's last message to the
// bot. Outside that window the bot sends the approved template instead (a short ping with a
// "Show details" button) and keeps the full alert; the owner's next message (or tapping the
// button) opens the window and delivers it.
// Meta does NOT refuse a late free-form message up front: it answers "sent" and reports the
// failure (131047) later, in a status the shop never sees. So the bot remembers when each owner
// last wrote, and outside the window goes straight to the template (found live 2026-11-09).
//   WA_ALERT_TEMPLATE  template name (default "website_alert"), language WA_ALERT_LANG (default "en")
//   body: Account alert for {{1}}: a customer has submitted a new {{2}} on your shop website,
//         reference {{3}}. Please review it and reply to the customer. Tap Show details to see the full request.
//   (button: quick reply "Show details"; category Utility)
const OUTSIDE_WINDOW = new Set([131047, 131026]);
let alertsFile = null;
function setAlertsFile(file) { alertsFile = file; }
function loadAlerts() { try { return JSON.parse(fs.readFileSync(alertsFile, "utf8")); } catch { return {}; } }
function saveAlerts(a) { if (alertsFile) try { writeJson(alertsFile, a); } catch (e) { console.error(`Couldn't save held alerts: ${e.message}`); } }
// Up to 200 held alerts per owner. Past that the oldest go, and one line says how many:
// { more: N } sits first in the list and is delivered as "+N more alerts".
const MAX_HELD = 200;
// Sends that failed, newest last, for the portal (pulse -> alertFailures). Kept next to the alerts file.
const failuresFile = () => alertsFile && alertsFile.replace(/(\.json)?$/, "-failures.json");
function alertFailures() { try { return JSON.parse(fs.readFileSync(failuresFile(), "utf8")); } catch { return []; } }
function noteFailure(to, kind, e) {
  console.error(`WhatsApp ${kind} to ${String(to).slice(0, 4)}… failed: ${e.message}`);
  if (!failuresFile()) return;
  const list = alertFailures();
  list.push({ at: new Date().toISOString(), to: `${String(to).slice(0, 4)}…`, kind, error: String(e.message).slice(0, 200) });
  try { writeJson(failuresFile(), list.slice(-50)); } catch { /* the console line above still has it */ }
}
// When each owner last messaged the bot. Unknown counts as outside the window.
const WINDOW_MS = 23 * 3600e3; // an hour short of Meta's 24, to be safe
const seenFile = () => alertsFile && alertsFile.replace(/(\.json)?$/, "-seen.json");
function lastIn(to) { try { return JSON.parse(fs.readFileSync(seenFile(), "utf8"))[to] || 0; } catch { return 0; } }
function noteIn(from) {
  if (!seenFile()) return;
  let all = {}; try { all = JSON.parse(fs.readFileSync(seenFile(), "utf8")); } catch { /* first time */ }
  all[from] = Date.now();
  try { fs.writeFileSync(seenFile(), JSON.stringify(all)); } catch { /* fine */ }
}
const inWindow = (to) => Date.now() - lastIn(to) < WINDOW_MS;
// Template values may not contain new lines, tabs or long runs of spaces.
const param = (v, max = 60) => ({ type: "text", text: (String(v || "-").replace(/[\n\t*_~]+/g, " ").replace(/ {2,}/g, " ").trim() || "-").slice(0, max) });

async function sendAlert(to, text, imageUrl) {
  if (imageUrl && text.length <= 1024) return sendImage(to, imageUrl, text);
  if (imageUrl) await sendImage(to, imageUrl, "");
  return sendText(to, text);
}

function holdAlert(to, text, imageUrl) {
  const queued = loadAlerts();
  const list = queued[to] || [];
  let more = list[0] && list[0].more ? list.shift().more : 0;
  list.push({ id: crypto.randomBytes(6).toString("hex"), text, imageUrl });
  while (list.length > MAX_HELD) { list.shift(); more++; }
  queued[to] = more ? [{ id: "more", more }, ...list] : list;
  saveAlerts(queued);
}

// A failed template is tried again a few times over the next ~20 minutes (1, 4, 15 min), then given up
// and recorded. The full alert is held on the disk either way, for the owner's next message.
const RETRY_MS = () => (Number(process.env.WA_RETRY_MS) || 60e3);
async function sendTemplate(to, text, imageUrl, summary, attempt = 0) {
  if (!attempt) holdAlert(to, text, imageUrl);
  try {
    await sendRaw(to, { type: "template", template: {
      name: process.env.WA_ALERT_TEMPLATE || "website_alert",
      language: { code: process.env.WA_ALERT_LANG || "en" },
      components: [{ type: "body", parameters: [param(summary.shop || "your shop", 40), param(summary.kind || "request", 20), param(summary.ref, 20)] }],
    } });
    console.log(`WhatsApp: owner ${to.slice(0, 4)}… outside the 24 h window, sent the alert template${attempt ? ` (try ${attempt + 1})` : ""}`);
  } catch (e2) {
    const waits = [1, 4, 15];
    noteFailure(to, attempt < waits.length ? `template (try ${attempt + 1}, will retry)` : `template (gave up after ${attempt + 1} tries)`, e2);
    if (attempt < waits.length) setTimeout(() => { if (!inWindow(to)) sendTemplate(to, text, imageUrl, summary, attempt + 1); }, waits[attempt] * RETRY_MS()).unref();
  }
}

async function notifyOwners(text, imageUrl, summary = {}) {
  if (!enabled()) return;
  for (const to of owners()) {
    if (!inWindow(to)) { await sendTemplate(to, text, imageUrl, summary); continue; }
    try {
      await sendAlert(to, text, imageUrl);
      console.log(`WhatsApp: alert sent to owner ${to.slice(0, 4)}…`);
    } catch (e) {
      if (!OUTSIDE_WINDOW.has(e.code)) { noteFailure(to, "alert", e); continue; }
      await sendTemplate(to, text, imageUrl, summary);
    }
  }
}

// Alerts held back while the owner was outside the 24-hour window. Returns how many were sent.
// Each one leaves the file only after it went out; a failed one stays for next time (5 tries at most).
async function deliverQueued(to) {
  const list = loadAlerts()[to] || [];
  if (!list.length) return 0;
  let n = 0;
  const done = (a, keep) => {
    const queued = loadAlerts(); // re-read: a new alert may have been held meanwhile
    const left = (queued[to] || []).filter((x) => (a.id ? x.id !== a.id : x.text !== a.text)).concat(keep ? [keep] : []);
    if (left.length) queued[to] = left; else delete queued[to];
    saveAlerts(queued);
  };
  for (const a of list) {
    try {
      if (a.more) await sendText(to, `➕ ${a.more} more alert${a.more === 1 ? "" : "s"} while you were away. See Online Orders in /billing for all of them.`);
      else await sendAlert(to, a.text, a.imageUrl);
      n++;
      done(a);
    } catch (e) {
      const tries = (a.tries || 0) + 1;
      noteFailure(to, tries >= 5 ? "held alert (dropped after 5 tries)" : "held alert", e);
      done(a, tries >= 5 ? null : { ...a, tries });
    }
  }
  return n;
}

// At start-up, make sure Meta actually sends incoming messages here (both calls are safe to repeat):
//  1. the WhatsApp Business Account (WA_WABA_ID) is subscribed to this app;
//  2. the app's webhook is subscribed to the "messages" field, pointing at our /webhook.
// Needs WA_APP_ID and WA_WABA_ID (not secret; both shown in Meta's WhatsApp setup page).
async function ensureSubscriptions(callbackUrl) {
  if (!enabled()) return;
  const { WA_APP_ID, WA_WABA_ID, WA_APP_SECRET, WA_VERIFY_TOKEN } = process.env;
  // Only the hub (the server Meta calls) subscribes; a shop behind the hub leaves these unset.
  if (!WA_WABA_ID || !WA_APP_ID) return console.log("WhatsApp: WA_APP_ID / WA_WABA_ID not set, so not subscribing (right for a shop behind a hub)");
  try {
    await graph(`${WA_WABA_ID}/subscribed_apps`, { method: "POST", body: "{}" });
    console.log("WhatsApp: business account subscribed to the app");
  } catch (e) { console.error(`WhatsApp: couldn't subscribe the business account: ${e.message}`); }
  if (!callbackUrl || !WA_VERIFY_TOKEN) return console.warn("WhatsApp: no public URL or WA_VERIFY_TOKEN, skipped the messages webhook subscription");
  try {
    const form = new URLSearchParams({
      object: "whatsapp_business_account", callback_url: callbackUrl, fields: "messages",
      verify_token: WA_VERIFY_TOKEN, include_values: "true", access_token: `${WA_APP_ID}|${WA_APP_SECRET}`,
    });
    const res = await fetch(`${GRAPH()}/${WA_APP_ID}/subscriptions`, { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    console.log("WhatsApp: webhook subscribed to messages");
  } catch (e) { console.error(`WhatsApp: couldn't subscribe the webhook to messages: ${e.message}`); }
}

module.exports = { enabled, verify, signatureOk, handleWebhook, notifyOwners, setAlertsFile, setSeenFile, drain, alertFailures, deliverQueued, isOwnerNumber, owners, ensureSubscriptions };
