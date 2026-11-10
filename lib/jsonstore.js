// Safe JSON files for the shop's books. Two rules that matter for money records:
//  - A save can't leave a half-written file: it writes a temp file, flushes it, then renames.
//  - A damaged file stops the server with an error. It never reads as "empty", because the
//    next save would then wipe every record in it.
const fs = require("fs");
const path = require("path");

function readJson(file, fallback) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (e) { if (e.code === "ENOENT") return fallback; throw e; }
  try { return JSON.parse(text); }
  catch { throw new Error(`${path.basename(file)} is damaged and was not loaded. Restore it from the backups folder.`); }
}

function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try { fs.writeSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

// One dated copy a day, the last `keep` days. Run at start-up and on a timer.
function dailyBackup(store, files, keep = 30) {
  const dir = path.join(store, "backups");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const dest = path.join(dir, today);
  {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of files) {
      const from = path.join(store, f);
      if (!fs.existsSync(from) || fs.existsSync(path.join(dest, f))) continue; // one copy a day; a skipped file is retried next run
      // A damaged file must never be copied in as today's backup: older good copies stay.
      try { JSON.parse(fs.readFileSync(from, "utf8")); }
      catch { console.error(`Backup skipped: ${f} is damaged. Older backups were kept.`); continue; }
      fs.copyFileSync(from, path.join(dest, f));
    }
    if (!fs.readdirSync(dest).length) fs.rmdirSync(dest); // nothing good to keep today: don't let an empty day push out an older one
  }
  const days = fs.readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  for (const old of days.slice(0, Math.max(0, days.length - keep))) fs.rmSync(path.join(dir, old), { recursive: true, force: true });
  return dest;
}

module.exports = { readJson, writeJson, dailyBackup };
