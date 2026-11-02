// Reads the owner's photo + caption with Claude and returns a clean product listing.
// Used when an Anthropic credential is available; otherwise server.js falls back to the
// keyword rules in parse.js. Any failure here also falls back, so a post is never lost.

const Anthropic = require("@anthropic-ai/sdk");
const { z } = require("zod");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");

const MODEL = process.env.VIBEX_MODEL || "claude-opus-5-5";

const Listing = z.object({
  name: z.string().describe("Short shop title, e.g. 'Bleu de Chanel Parfum' or 'Nuptse 700 Puffer Jacket'"),
  brand: z.string().nullable(),
  category: z.enum(["Clothing", "Fragrances", "Footwear", "Accessories"]),
  subcategory: z.string().describe("One or two words, e.g. Jacket, Hoodie, Jeans, T-shirt, Perfume, Attar, Sneakers, Boots, Cap, Bag"),
  price: z.number().int().nullable().describe("Selling price in rupees from the caption, or null"),
  mrp: z.number().int().nullable().describe("Original/retail price in rupees if the caption gives one, else null"),
  sizes: z.string().nullable().describe("Sizes or volume, e.g. 'M · L', 'UK 8 · 9', '100 ml'"),
  quantity: z.number().int().nullable().describe("How many the shop has if the caption says, e.g. '3 pcs' -> 3, else null"),
  note: z.string().nullable().describe("One short sentence for the owner ONLY if the photo and caption disagree, else null"),
});

const SYSTEM = `You list products for Vibe X, a surplus store in Srinagar, Kashmir that sells original world-brand clothing, footwear and fragrances.
The shop owner sends a product photo (often a screenshot of their WhatsApp or Instagram story) with a short, casual caption.
Fill in the listing:
- Decide what the item is from the PHOTO first: read brand names and labels printed on the product. Captions are often brief or mistyped.
- Take price, MRP and sizes from the CAPTION. A bare number like "2000" is the price in rupees. Never invent a price or size.
- If the caption names a different brand or product than the photo clearly shows, list what the photo shows and say so in "note".
- Ignore app overlays such as the story header, username and timestamps.
- Keep the name short and shop-like, without the price or size.`;

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
  return client;
}

// Only worth trying when a credential is configured.
const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

async function classify(text, imageDataUrl) {
  const content = [];
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(imageDataUrl || "");
  if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  content.push({ type: "text", text: `Caption: ${text.trim() || "(no caption)"}` });

  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(Listing) },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") throw new Error(`declined: ${response.stop_details?.category ?? "unknown"}`);
  if (!response.parsed_output) throw new Error(`no listing returned (stop_reason ${response.stop_reason})`);
  return response.parsed_output;
}

module.exports = { classify, aiEnabled, MODEL };
