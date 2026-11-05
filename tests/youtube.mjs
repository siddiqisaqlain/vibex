// Picking the latest video, and staying up when YouTube misbehaves. Needs no network.
// `node tests/youtube.mjs`
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { videoFeed, parseFeed, headline } = createRequire(import.meta.url)("../lib/youtube.js");

const entry = (id, title, { link = `https://www.youtube.com/watch?v=${id}`, views = 10 } = {}) =>
  `<entry><yt:videoId>${id}</yt:videoId><title>${title}</title><link rel="alternate" href="${link}"/><published>2026-09-09T15:28:55+00:00</published><media:statistics views="${views}"/></entry>`;
const A = "aaaaaaaaaaa", B = "bbbbbbbbbbb", C = "ccccccccccc", F = "fffffffffff";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibex-yt-"));
let n = 0;
const make = (routes, opts = {}) => {
  const warned = [];
  const file = opts.file || path.join(dir, `v${n++}.json`);
  const fetch = async (url) => {
    for (const [test, answer] of routes) if (url.includes(test)) {
      if (answer instanceof Error) throw answer;
      return { ok: answer.status < 400, status: answer.status, text: async () => answer.body || "" };
    }
    return { ok: false, status: 404, text: async () => "" };
  };
  return { warned, file, feed: videoFeed({ channelId: "UCx", fallback: { id: F, title: "Fallback | x", published: "" }, file, fetch, warn: (...a) => warned.push(a.join(" ")) }) };
};
const ok = (body) => ({ status: 200, body });
let pass = 0; const check = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log("ok  ", name); });

await check("parses ids, titles and Shorts", () => {
  const [a, b] = parseFeed(entry(A, "Sale &amp; more  now") + entry(B, "Levis", { link: `https://www.youtube.com/shorts/${B}` }));
  assert.equal(a.title, "Sale & more now"); assert.equal(a.short, false); assert.equal(b.short, true);
  assert.equal(parseFeed(entry("bad id", "x")).length, 0);
});
await check("headline takes the part before the first bar", () => {
  assert.equal(headline("100% Original Watches | 80% Discount"), "100% Original Watches");
  assert.equal(headline("Plain title"), "Plain title");
});
await check("shows the fallback before the first check", () => {
  assert.equal(make([]).feed.current().id, F);
});
await check("picks the newest video and uses the sharper pictures", async () => {
  const { feed } = make([["feeds/videos", ok(entry(A, "New | x") + entry(B, "Old"))], ["oembed", ok()], ["vi_webp", ok()]]);
  const v = await feed.refresh();
  assert.equal(v.id, A); assert.equal(v.headline, "New"); assert.match(v.thumb, /sddefault\.webp/); assert.match(v.thumbBig, /maxresdefault\.webp/);
});
await check("falls back to hqdefault when sharper pictures don't exist", async () => {
  const { feed } = make([["feeds/videos", ok(entry(A, "New"))], ["oembed", ok()]]);
  const v = await feed.refresh();
  assert.match(v.thumb, /hqdefault\.jpg/); assert.equal(v.thumbBig, "");
});
await check("skips a video that blocks embedding, and a premiere with no views", async () => {
  const { feed } = make([["feeds/videos", ok(entry(C, "Premiere", { views: 0 }) + entry(A, "Blocked") + entry(B, "Good"))],
    [`v%3D${A}`, { status: 401 }], ["oembed", ok()]]);
  assert.equal((await feed.refresh()).id, B);
});
await check("a failed embed check doesn't hide the video", async () => {
  const { feed } = make([["feeds/videos", ok(entry(A, "New"))], ["oembed", new Error("timeout")]]);
  assert.equal((await feed.refresh()).id, A);
});
await check("keeps the last good video when the feed fails, across a restart", async () => {
  const first = make([["feeds/videos", ok(entry(A, "New"))], ["oembed", ok()]]);
  await first.feed.refresh();
  const second = make([["feeds/videos", { status: 403 }]], { file: first.file });
  assert.equal((await second.feed.refresh()).id, A);
  assert.match(second.warned[0], /keeping the current video/);
});
await check("an empty or garbage feed changes nothing", async () => {
  const { feed } = make([["feeds/videos", ok("<html>consent</html>")]]);
  assert.equal((await feed.refresh()).id, F);
});
await check("a damaged cache file falls back instead of stopping the server", () => {
  const file = path.join(dir, "bad.json"); fs.writeFileSync(file, "{nope");
  assert.equal(make([], { file }).feed.current().id, F);
});
console.log(`\n${pass} checks passed`);
