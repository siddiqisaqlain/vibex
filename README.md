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
2. Open `https://YOUR-SITE.onrender.com/demo?key=OWNER_KEY` for the owner screen.

On Render's free plan the server sleeps when idle and its disk resets on restart, so products and orders added after deploy go back to the samples. That's fine for a demo. For real use, add a persistent disk or a database.

## Before going live for real

- Replace the demo payment details in `public/config.js` and set `demo: false`.
- Have the shop review the draft Returns, Terms and Privacy pages (`lib/legal.js`).
- Connect the shop's WhatsApp number through the WhatsApp Cloud API.
