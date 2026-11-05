# Vibe X

A live shop website for **Vibe X (The Surplus Room)**, Srinagar. The owner posts a product photo with a short caption on WhatsApp, and it appears on the website by itself, sorted into Clothing, Fragrances, Footwear or Accessories.

Customers can:

- browse the rack, filtered by category and type
- **Order now**: choose pickup or delivery, pay by UPI QR, bank transfer or phone number, then send the payment reference or a screenshot. The piece goes on hold until the owner confirms.
- **Enquire**: leave a WhatsApp number. The owner gets the product photo and the customer's details.

The owner, from WhatsApp (or the `/demo` screen):

- posts a photo and caption to list a product, e.g. `Carhartt jacket 4999 size L` or `Gucci Guilty 2499 3 pcs` (stock: `3 pcs`, `x3`, `qty 3`, `stock 3`)
- gets back the product's 4-digit code (the LOT number on the site), then manages stock with it:
  `sold 4795` (one), `sold 4795 2`, `add 4795 3`, `stock 4795 5`, `remove 4795`
- `confirm VX-1234` or `cancel VX-1234` for orders; `help` lists every command

> This version is a working demo. The WhatsApp side is simulated on the `/demo` screen; connecting the shop's real WhatsApp number (WhatsApp Cloud API) is the next step.

## Site analytics

`/analytics` (owner key, the same as the billing portal, or the Site Analytics link there) shows who is on the site now, and what helps or hinders them:

- **Shop floor**: the site as connected tanks of water. One visitor is one droplet; thousands merge into pools that flow between rooms, and rooms swell and shrink with the crowd. Press a room to open it. Live, replayed in a minute, or a whole period, for everyone or one group of visitors
- **Fix first**: the problems on the site ranked by the most each could be costing, each marked with how strong the evidence is Replay today or yesterday in a minute and watch the worn paths build up
- **Order form**: every box in the order and enquiry forms: typical time, keys, corrections, errors, left empty, and where people quit, plus how long each step of buying takes
- **The leak**: the journey from arriving to paying as a river that loses people at each step, plain-language findings, why people left, what customers said, and a log of your changes with the numbers before and after
- **Traffic, Scroll map, Products, Visits**: rhythm of the week, who buys, how far down people get and the time spent in each section, every button pressed, a map of products by interest and sales with how often each was seen, and each visit as a thread of beads with where its time went

Every chart keeps its numbers one tap away, with Excel downloads.

`lib/track.js` runs on shop pages and `lib/analytics.js` keeps one file a day in `analytics/` on the disk, for about 13 months. It stores no IP address, cookie or form contents. Visitors with Global Privacy Control on aren't counted, and opening `/analytics` stops your own browser being counted. Customers get a short question after leaving checkout or ordering, at most once a day, and there's a Feedback link in the footer.

## Run it locally

```bash
npm install
npm start
```

Open http://localhost:4300 for the shop and http://localhost:4300/demo for the owner's WhatsApp beside the live site.

## Settings

| Where | What |
|---|---|
| `public/config.js` | Shop name, Instagram, Google Maps link, WhatsApp number, **payment details** (currently demo values that can't receive money) |
| `.env` or host settings | `OWNER_KEY`: required on a public server. Locks `/demo` and the owner controls; open them with `/demo?key=YOUR_KEY` |
| | `ANTHROPIC_API_KEY`: optional. Lets AI read product photos to name and sort them. Without it, keyword rules read the caption |
| | `PUBLIC_URL`: optional. The site's public address for link previews; detected automatically on Render |
| | `DESIGN`: serve a saved design instead of the current one: `v1` first surplus, `v2` dark minimal, `v3` colourful, `v4` surplus on the v2 layout (all in `designs/`) |

## Deploy on Render

1. render.com → **New** → **Blueprint** → choose this repository. `render.yaml` sets everything up and generates an `OWNER_KEY`.
2. Open `https://YOUR-DOMAIN/demo?key=OWNER_KEY` for the owner screen.

On Render's free plan the server sleeps when idle and its disk resets on restart, so products and orders added after deploy go back to the samples. That's fine for a demo. For real use, add a persistent disk or a database.

## Before going live for real

- Replace the demo payment details in `public/config.js` and set `demo: false`.
- Have the shop review the draft Returns, Terms and Privacy pages (`lib/legal.js`).
- Connect the shop's WhatsApp number through the WhatsApp Cloud API.
