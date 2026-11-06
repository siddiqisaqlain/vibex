// Does the owner's sums on its own thread, so a 90-day report can never make the shop stutter for a customer.
// Raw events become compact visit records once a day is over; raw files then go, within a fixed disk budget.
const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const R = require("./rollup");

const { DIR, RAW_DAYS, KEEP_DAYS, BUDGET } = workerData;
const rawOf = (d) => path.join(DIR, `${d}.jsonl`), recsOf = (d) => path.join(DIR, `${d}.vis.gz`), recentOf = (d) => path.join(DIR, `${d}.recent.gz`);
const shift = (d, n) => new Date(Date.parse(d) + n * R.DAY_MS).toISOString().slice(0, 10);
const daysIn = (from, to) => { const out = []; for (let d = from; d <= to; d = shift(d, 1)) out.push(d); return out; };
const strip = (r) => { const { steps, _p, _st, _z, _b, _room, ...keep } = r; return keep; };

// Today is read a little at a time, from where the last read stopped.
const open = new Map(); // day -> { offset, tail, visits: Map }
function feedDay(day) {
  const st = open.get(day) || { offset: 0, tail: "", visits: new Map() };
  open.set(day, st);
  let size = 0;
  try { size = fs.statSync(rawOf(day)).size; } catch { return st; }
  if (size <= st.offset) return st;
  const fd = fs.openSync(rawOf(day), "r"), CHUNK = 8 * 1024 * 1024, buf = Buffer.alloc(CHUNK);
  try {
    while (st.offset < size) {
      const n = fs.readSync(fd, buf, 0, CHUNK, st.offset);
      if (!n) break;
      st.offset += n;
      const text = st.tail + buf.toString("utf8", 0, n), lines = text.split("\n");
      st.tail = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; } // one bad line can only lose that line
        let r = st.visits.get(ev.s);
        if (!r) st.visits.set(ev.s, r = R.newRecord(ev));
        R.feed(r, ev);
      }
    }
  } finally { fs.closeSync(fd); }
  // Keep the step by step only for the latest visits; the rest are just their record.
  if (st.visits.size > R.MAX_VISITS_SHOWN * 1.5) {
    const late = [...st.visits.values()].sort((a, b) => b.a - a.a);
    for (let i = R.MAX_VISITS_SHOWN; i < late.length; i++) late[i].steps = [];
  }
  return st;
}
// A finished day becomes one small file of records, and the day's raw file can go later.
function closeDay(day) {
  if (fs.existsSync(recsOf(day)) || !fs.existsSync(rawOf(day))) return;
  const st = feedDay(day), list = [...st.visits.values()].filter(R.hasStart);
  const write = (file, rows) => { const tmp = `${file}.tmp`; fs.writeFileSync(tmp, zlib.gzipSync(rows.map((x) => JSON.stringify(x)).join("\n"))); fs.renameSync(tmp, file); };
  write(recsOf(day), list.map(strip));
  write(recentOf(day), [...list].sort((a, b) => b.a - a.a).slice(0, R.MAX_VISITS_SHOWN).map((r) => { const { _p, _st, _z, _b, _room, ...keep } = r; return keep; }));
  open.delete(day);
}
function* recordsOf(day) {
  let text; try { text = zlib.gunzipSync(fs.readFileSync(recsOf(day))).toString("utf8"); } catch { return; }
  for (const line of text.split("\n")) { if (!line) continue; try { yield JSON.parse(line); } catch { /* skip it */ } }
}
function* eachVisit(from, to, today) {
  for (const day of daysIn(from, to)) {
    if (day > today) break;
    if (day < today) { closeDay(day); yield* recordsOf(day); } else for (const r of feedDay(day).visits.values()) if (R.hasStart(r)) yield r;
  }
}
function report({ from, to, seg, today, names }) {
  const name = (id) => names[id] || id, keep = R.segmentTest(seg);
  const prevFrom = shift(from, -(daysIn(from, to).length)), prevTo = shift(from, -1), P = R.newTotals();
  for (const r of eachVisit(prevFrom, prevTo, today)) if (keep(r)) R.addTotals(P, r);
  const rep = R.newReport({ from, to });
  for (const r of eachVisit(from, to, today)) if (keep(r)) rep.recentSeen = true, R.addRecord(rep, r);
  // step by step for finished days comes from their short list
  const extra = [];
  for (const day of daysIn(from, to).reverse()) {
    if (day >= today) continue;
    if (rep.recent.length + extra.length >= R.MAX_VISITS_SHOWN) break;
    try { for (const line of zlib.gunzipSync(fs.readFileSync(recentOf(day))).toString("utf8").split("\n")) { if (!line) continue; const r = JSON.parse(line); if (keep(r)) extra.push(r); } } catch { /* a day with no visits */ }
  }
  return R.finish(rep, { name, prevTotals: P.visits ? R.readTotals(P) : null, recentExtra: extra });
}
function totals({ from, to, today }) {
  const T = R.newTotals();
  for (const r of eachVisit(from, to, today)) R.addTotals(T, r);
  return R.readTotals(T);
}
// Raw goes first, then the oldest records: analytics may never crowd out orders and photos on the disk.
function prune({ today }) {
  const files = fs.readdirSync(DIR).map((f) => ({ f, day: f.slice(0, 10), raw: f.endsWith(".jsonl"), size: fs.statSync(path.join(DIR, f)).size })).filter((x) => /^\d{4}-\d{2}-\d{2}/.test(x.f) && !x.f.endsWith(".tmp")).sort((a, b) => a.day.localeCompare(b.day));
  const rm = (x) => { fs.rmSync(path.join(DIR, x.f), { force: true }); x.gone = true; };
  for (const day of [...new Set(files.filter((x) => x.raw && x.day < today).map((x) => x.day))]) closeDay(day);
  const rawCut = shift(today, -RAW_DAYS), keepCut = shift(today, -KEEP_DAYS);
  for (const x of files) if ((x.raw && x.day < rawCut && fs.existsSync(recsOf(x.day))) || x.day < keepCut) rm(x);
  const left = () => files.filter((x) => !x.gone && x.day < today);
  let used = sum(files.filter((x) => !x.gone));
  for (const x of left().filter((y) => y.raw)) { if (used <= BUDGET) break; if (fs.existsSync(recsOf(x.day))) { used -= x.size; rm(x); } }
  for (const x of left()) { if (used <= BUDGET) break; used -= x.size; rm(x); }
  return { used };
}
function sum(list) { return list.reduce((n, x) => n + x.size, 0); }

function model({ today }) {
  const F = R.newFit();
  for (const r of eachVisit(shift(today, -60), today, today)) R.addFit(F, r);
  return R.readFit(F);
}
const JOBS = { report, totals, prune, model };
parentPort.on("message", ({ id, job, args }) => {
  try { parentPort.postMessage({ id, ok: JOBS[job](args) }); } catch (e) { parentPort.postMessage({ id, error: e.message }); }
});
