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
async function downloadMedia(id) {
  const meta = await graph(encodeURIComponent(id));
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` } });
  if (!res.ok) throw new Error(`media download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
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
    case "video": return { text: m.video?.caption || "", mediaType: "video", image: "video" };
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
const seen = new Map();
const lanes = new Map();
const albums = new Map(); // photos from one number still arriving: { msgs, last }
// Runs one job after the previous ones from the same number.
function queueJob(from, shops, job, id = "album") {
  const lane = (lanes.get(from) || Promise.resolve()).then(job).catch(async (e) => {
    console.error(`WhatsApp message ${id}: ${e.message}`);
    if (shops.length) await sendText(from, "⚠️ Something went wrong on my side. Please send that again in a minute.").catch(() => {});
  });
  lanes.set(from, lane);
  lane.finally(() => { if (lanes.get(from) === lane) lanes.delete(from); });
}
function handleWebhook(payload, { ownerMessage, shopName, shopUrl, shopKey, choiceFile }, raw, sig) {
  const now = Date.now();
  const local = { key: String(shopKey || process.env.WA_SHOP_KEY || shopName.split(/\s+/)[0]).toLowerCase(), name: shopName };
  const forwarded = new Set();
  for (const [id, t] of seen) if (now - t > 24 * 3600e3) seen.delete(id);
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const m of change.value?.messages || []) {
        if (!m.id || seen.has(m.id)) continue;
        seen.set(m.id, now);
        const from = digits(m.from);
        const shops = shopsFor(from, local);
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
            while (Date.now() - album.last < quiet) await new Promise((r) => setTimeout(r, quiet - (Date.now() - album.last) + 20));
            albums.delete(from);
            await deliverQueued(from);
            const got = (await Promise.all(album.msgs.map((x) => toOwnerMessage(x).catch((e) => { console.error(`WhatsApp photo download: ${e.message}`); return null; })))).filter(Boolean);
            if (!got.length) throw new Error("no photo could be downloaded");
            console.log(`WhatsApp: ${got.length} photo${got.length > 1 ? "s" : ""} together`);
            const out = await ownerMessage(got.length === 1 ? got[0] : { photos: got });
            await sendReply(from, out.reply || out.error || "Something went wrong.", out.buttons, out.list, out.photo);
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
  }
}

// Enquiries and orders from the website go to every owner number.
// WhatsApp only allows free-form messages within 24 hours of the owner's last message to the
// bot. Outside that window Meta refuses them (error 131047), so the bot sends the approved
// template instead (a short ping with a "Show details" button) and keeps the full alert;
// the owner's next message (or tapping the button) opens the window and delivers it.
//   WA_ALERT_TEMPLATE  template name (default "website_alert"), language WA_ALERT_LANG (default "en")
//   body: Account alert for {{1}}: a customer has submitted a new {{2}} on your shop website,
//         reference {{3}}. Please review it and reply to the customer. Tap Show details to see the full request.
//   (button: quick reply "Show details"; category Utility)
const OUTSIDE_WINDOW = new Set([131047, 131026]);
let alertsFile = null;
function setAlertsFile(file) { alertsFile = file; }
function loadAlerts() { try { return JSON.parse(fs.readFileSync(alertsFile, "utf8")); } catch { return {}; } }
function saveAlerts(a) { if (alertsFile) try { fs.writeFileSync(alertsFile, JSON.stringify(a)); } catch { /* fine */ } }
// Template values may not contain new lines, tabs or long runs of spaces.
const param = (v, max = 60) => ({ type: "text", text: (String(v || "-").replace(/[\n\t*_~]+/g, " ").replace(/ {2,}/g, " ").trim() || "-").slice(0, max) });

async function sendAlert(to, text, imageUrl) {
  if (imageUrl && text.length <= 1024) return sendImage(to, imageUrl, text);
  if (imageUrl) await sendImage(to, imageUrl, "");
  return sendText(to, text);
}

async function notifyOwners(text, imageUrl, summary = {}) {
  if (!enabled()) return;
  for (const to of owners()) {
    try {
      await sendAlert(to, text, imageUrl);
    } catch (e) {
      if (!OUTSIDE_WINDOW.has(e.code)) { console.error(`Couldn't send to owner ${to.slice(0, 4)}…: ${e.message}`); continue; }
      const queued = loadAlerts();
      (queued[to] = queued[to] || []).push({ text, imageUrl });
      queued[to] = queued[to].slice(-20);
      saveAlerts(queued);
      try {
        await sendRaw(to, { type: "template", template: {
          name: process.env.WA_ALERT_TEMPLATE || "website_alert",
          language: { code: process.env.WA_ALERT_LANG || "en" },
          components: [{ type: "body", parameters: [param(summary.shop || "your shop", 40), param(summary.kind || "request", 20), param(summary.ref, 20)] }],
        } });
        console.log(`WhatsApp: owner ${to.slice(0, 4)}… outside the 24 h window, sent the alert template`);
      } catch (e2) {
        console.error(`Couldn't send the alert template to ${to.slice(0, 4)}…: ${e2.message}`);
      }
    }
  }
}

// Alerts held back while the owner was outside the 24-hour window. Returns how many were sent.
async function deliverQueued(to) {
  const queued = loadAlerts();
  const list = queued[to] || [];
  if (!list.length) return 0;
  delete queued[to];
  saveAlerts(queued);
  let n = 0;
  for (const a of list) {
    try { await sendAlert(to, a.text, a.imageUrl); n++; } catch (e) { console.error(`Couldn't deliver a held alert: ${e.message}`); }
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

module.exports = { enabled, verify, signatureOk, handleWebhook, notifyOwners, setAlertsFile, deliverQueued, isOwnerNumber, owners, ensureSubscriptions };
