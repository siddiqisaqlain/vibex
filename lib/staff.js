// Staff logins for the billing portal. Each person gets a name and a PIN. The limits are
// enforced on the server: what a role can't do isn't just hidden, it's refused, and staff
// never receive cost prices. The owner keeps using the owner key.
const path = require("path");
const crypto = require("crypto");
const { readJson, writeJson } = require("./jsonstore");

const hash = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString("hex");
const SESSION_MS = 12 * 3600e3, MAX_TRIES = 5, MAX_NAME_TRIES = 10, LOCK_MS = 10 * 60e3;

// What a staff login may reach. Everything else under /api/billing/ is refused.
const STAFF_ROUTES = [["GET", /^me$/], ["GET", /^pulse$/], ["GET", /^products$/], ["GET", /^invoices$/], ["POST", /^invoices$/], ["GET", /^parties$/]];

module.exports = function createStaff({ STORE }) {
  const FILE = path.join(STORE, "staff.json");
  const all = () => readJson(FILE, []);
  const sessions = new Map(); // token hash -> { staffId, name, exp }. A restart logs staff out, on purpose.
  const tries = new Map();
  const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

  function add({ name, pin }) {
    name = String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!name) return { error: "Add a name." };
    if (!/^\d{4,6}$/.test(String(pin || ""))) return { error: "The PIN must be 4 to 6 digits." };
    const list = all();
    if (list.some((s) => s.name.toLowerCase() === name.toLowerCase())) return { error: `${name} already has a login.` };
    const salt = crypto.randomBytes(16).toString("hex");
    const row = { id: crypto.randomBytes(8).toString("hex"), name, salt, pinHash: hash(pin, salt), createdAt: new Date().toISOString() };
    list.push(row);
    writeJson(FILE, list);
    return { staff: { id: row.id, name } };
  }
  function remove(id) {
    const list = all();
    if (!list.some((s) => s.id === id)) return { error: "Not found." };
    writeJson(FILE, list.filter((s) => s.id !== id));
    for (const [k, v] of sessions) if (v.staffId === id) sessions.delete(k);
    return { ok: true };
  }
  // Wrong PINs are counted two ways: per name+address (5 tries), and per name across every address
  // (10 tries in 10 minutes), so a PIN can't be farmed from many phones. The name is the staff
  // member's id when there is one, so " Ali", "ali" and "ALI " share one count. Unknown names count too.
  const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);
  const prune = () => { if (tries.size > 5000) { const now = Date.now(); for (const [k, v] of tries) if (v.until < now && (!v.first || v.first < now - LOCK_MS)) tries.delete(k); } };
  function login({ name, pin }, ip) {
    const nm = norm(name), s = all().find((x) => x.name.toLowerCase() === nm);
    const who_ = s ? `id:${s.id}` : `name:${nm}`, ipKey = `${who_}|${ip}`, nameKey = `${who_}|*`, now = Date.now();
    const t = tries.get(ipKey), g = tries.get(nameKey);
    if ((t && t.until > now) || (g && g.until > now)) return { error: "Too many wrong PINs. Try again in 10 minutes.", status: 429 };
    const given = hash(pin ?? "", s?.salt || "0".repeat(32));
    if (!s || !crypto.timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(s.pinHash, "hex"))) {
      const n = (t?.n || 0) + 1;
      tries.set(ipKey, n >= MAX_TRIES ? { n: 0, until: now + LOCK_MS } : { n, until: 0 });
      const fresh = g && g.first > now - LOCK_MS, gn = (fresh ? g.n : 0) + 1;
      tries.set(nameKey, gn >= MAX_NAME_TRIES ? { n: 0, first: 0, until: now + LOCK_MS } : { n: gn, first: fresh ? g.first : now, until: 0 });
      prune();
      return { error: "Wrong name or PIN.", status: 401 };
    }
    tries.delete(ipKey);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(sha(token), { staffId: s.id, name: s.name, exp: now + SESSION_MS });
    return { token, name: s.name };
  }
  function who(token) {
    if (!token) return null;
    const k = sha(String(token)), v = sessions.get(k);
    if (!v) return null;
    if (v.exp < Date.now()) { sessions.delete(k); return null; }
    return { role: "staff", name: v.name };
  }
  const allowed = (method, route) => STAFF_ROUTES.some(([m, r]) => m === method && r.test(route));
  const list = () => all().map(({ id, name, createdAt }) => ({ id, name, createdAt }));
  return { add, remove, login, who, allowed, list };
};
