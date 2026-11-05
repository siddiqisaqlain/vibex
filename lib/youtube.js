// The newest video on the shop's YouTube channel, for the home page. The server reads YouTube's
// public feed and hands the result to the page inside /config.js, so visitors never wait on
// YouTube, and the section is there on first paint. If YouTube is down or blocks us, the last
// good video stays up (saved to disk), then the fallback in shop.json.
const { readJson, writeJson } = require("./jsonstore");

const TIMEOUT_MS = 8000;
const CHECK_NEWEST = 5; // how far down the feed to look for a video that can be embedded
const VIDEO_ID = /^[\w-]{11}$/;

const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|apos);/g, (m, e) =>
  ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" }[e]));

function parseFeed(xml) {
  const out = [];
  for (const [entry] of String(xml).matchAll(/<entry>[\s\S]*?<\/entry>/g)) {
    const id = entry.match(/<yt:videoId>([^<]+)</)?.[1];
    if (!id || !VIDEO_ID.test(id)) continue;
    const title = decode(entry.match(/<title>([^<]*)</)?.[1] || "").replace(/\s+/g, " ").trim();
    out.push({
      id, title,
      published: entry.match(/<published>([^<]+)</)?.[1] || "",
      short: /<link[^>]*href="[^"]*\/shorts\//.test(entry),
      views: Number(entry.match(/<media:statistics[^>]*views="(\d+)"/)?.[1] ?? -1),
    });
  }
  return out;
}

// Long YouTube titles are keyword lists: "100% Original Watches | 80% Discount | New Models".
const headline = (title) => title.split("|")[0].trim() || title;

// sd and maxres aren't made for every video; hq always is. The page crops hq's black bars.
function shape(v, thumbs = {}) {
  return { id: v.id, title: v.title, headline: headline(v.title), published: v.published, short: Boolean(v.short),
    thumb: thumbs.thumb || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, thumbBig: thumbs.thumbBig || "" };
}

function videoFeed({ channelId, fallback, file, fetch: get = globalThis.fetch, warn = console.warn }) {
  let saved = null;
  try { saved = readJson(file, null); } catch { /* only a cache: the next refresh rewrites it */ }
  let now = saved?.id && VIDEO_ID.test(saved.id) ? saved : fallback?.id && VIDEO_ID.test(fallback.id) ? shape(fallback) : null;

  const hit = (url, method = "GET") => get(url, { method, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
  const exists = (url) => hit(url, "HEAD").then((r) => r.ok, () => false);

  // Owners can block embedding, and a deleted video can linger in the feed. Unknown = allow.
  async function canEmbed(id) {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
    try { return ![401, 403, 404].includes((await hit(url)).status); } catch { return true; }
  }

  async function refresh() {
    try {
      const res = await hit(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
      if (!res.ok) throw new Error(`feed answered ${res.status}`);
      // A premiere that hasn't aired sits in the feed with no views.
      const entries = parseFeed(await res.text()).filter((v) => v.views !== 0).slice(0, CHECK_NEWEST);
      if (!entries.length) throw new Error("feed had no videos");
      let pick = null;
      for (const v of entries) if (await canEmbed(v.id)) { pick = v; break; }
      if (!pick) throw new Error("no embeddable video in the newest entries");
      const sd = `https://i.ytimg.com/vi_webp/${pick.id}/sddefault.webp`;
      const big = `https://i.ytimg.com/vi_webp/${pick.id}/maxresdefault.webp`;
      const [hasSd, hasBig] = await Promise.all([exists(sd), exists(big)]);
      const next = shape(pick, { thumb: hasSd ? sd : "", thumbBig: hasBig ? big : "" });
      if (JSON.stringify(next) !== JSON.stringify(now)) {
        now = next;
        try { writeJson(file, next); } catch (e) { warn("youtube: could not save the video:", e.message); }
      }
    } catch (e) {
      warn("youtube: keeping the current video:", e.message);
    }
    return now;
  }

  return { current: () => now, refresh };
}

module.exports = { videoFeed, parseFeed, headline };
