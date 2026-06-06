# Setup Guide

## 1. Install and build

```bash
cd mcp-server
npm install
npm run build          # compiles to build/index.js
```

## 2. Create working folders

```bash
# from repo root
mkdir Inbox drafts listings
```

## 3. Environment variables

```bash
cp mcp-server/.env.example mcp-server/.env
```

Fill in `mcp-server/.env`. Required values:

| Variable | Where to find it |
|---|---|
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | developer.ebay.com → Your Applications → Production keys |
| `EBAY_REFRESH_TOKEN` | Complete the eBay OAuth flow (see README § Getting Credentials) |
| `EBAY_RUNAME` | developer.ebay.com → User Tokens → RuName |
| `EBAY_FULFILLMENT_POLICY_ID` | eBay Seller Hub → Account → Business Policies |
| `EBAY_PAYMENT_POLICY_ID` | eBay Seller Hub → Account → Business Policies |
| `EBAY_RETURN_POLICY_ID` | eBay Seller Hub → Account → Business Policies |
| `EBAY_LOCAL_PICKUP_FULFILLMENT_POLICY_ID` | eBay Seller Hub → Business Policies (your local pickup policy) |
| `EBAY_LOCAL_PICKUP_PAYMENT_POLICY_ID` | eBay Seller Hub → Business Policies (your pay-in-person policy) |
| `EBAY_MERCHANT_LOCATION_KEY` | Set to `default-location` (see step 5) |
| `GOOGLE_VISION_API_KEY` | console.cloud.google.com → APIs & Services → Credentials |
| `GEMINI_API_KEY` | ai.google.dev |
| `GEMINI_MODEL` | e.g. `gemini-3.1-flash-lite` — text/research model |
| `GEMINI_IMAGE_MODEL` | e.g. `gemini-3.1-flash-image` — photo enhancement model (see [photo-preparation.md](photo-preparation.md)) |
| `ETSY_API_KEY` / `ETSY_CLIENT_ID` | etsy.com/developers/your-apps (same value for both) |
| `ETSY_REFRESH_TOKEN` | Complete the Etsy OAuth flow (scopes: `listings_w listings_r`) |
| `ETSY_SHOP_ID` | Numeric ID visible in Etsy Shop Manager URL |
| `ETSY_SHIPPING_PROFILE_ID` | Shop Manager → Settings → Shipping |
| `ETSY_RETURN_POLICY_ID` | Shop Manager → Settings → Returns |

> **Etsy token rotation:** Etsy issues a new refresh token on every use. After any server restart, update `ETSY_REFRESH_TOKEN` in both `.env` and the Claude Desktop config with the token the server logged to stderr.

## 4. Configure Claude Desktop

Add the server to your Claude Desktop config file and copy **all** env vars into the `env` block (Claude Desktop does not load `.env`).

Config file locations:
- **Windows (Store):** `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`
- **Windows (direct):** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "listing-workflow": {
      "command": "node",
      "args": ["C:/full/path/to/listing-workflow/mcp-server/build/index.js"],
      "env": {
        "EBAY_CLIENT_ID": "...",
        "EBAY_CLIENT_SECRET": "...",
        "EBAY_REFRESH_TOKEN": "...",
        "EBAY_RUNAME": "...",
        "EBAY_ENVIRONMENT": "production",
        "EBAY_FULFILLMENT_POLICY_ID": "...",
        "EBAY_PAYMENT_POLICY_ID": "...",
        "EBAY_RETURN_POLICY_ID": "...",
        "EBAY_LOCAL_PICKUP_FULFILLMENT_POLICY_ID": "...",
        "EBAY_LOCAL_PICKUP_PAYMENT_POLICY_ID": "...",
        "EBAY_MERCHANT_LOCATION_KEY": "default-location",
        "GOOGLE_VISION_API_KEY": "...",
        "GEMINI_API_KEY": "...",
        "GEMINI_MODEL": "gemini-2.0-flash",
        "ETSY_API_KEY": "...",
        "ETSY_CLIENT_ID": "...",
        "ETSY_REFRESH_TOKEN": "...",
        "ETSY_SHOP_ID": "...",
        "ETSY_SHIPPING_PROFILE_ID": "...",
        "ETSY_RETURN_POLICY_ID": "..."
      }
    }
  }
}
```

Restart Claude Desktop. A hammer icon in the chat input confirms the server is connected.

## 5. One-time eBay merchant location

eBay requires a merchant location before any listing can be published. Do this once in a Claude Desktop chat with the MCP server connected:

> "Call `ebay_create_merchant_location` with key `default-location`"

## 6. Add the skill

In Claude Desktop, create a **Project** and paste the full contents of `cowork-skill/listing-workflow.md` as the **Project instructions**.

---

## Running the workflow

1. Drop photos into `Inbox/` at the repo root
2. In the listing-workflow project, say **"List an item"**
3. Claude runs Phase 1 (research) and saves a draft + `item-log.md` to `drafts/[item-name]/`
4. Review the draft; approve or request edits
5. Say **"Create the listing"** to start Phase 2
6. Choose eBay, Etsy, or both — and for eBay, whether it's **shipped** or **local pickup only**
7. For shipped: confirm or correct the agent's package dimension/weight estimate
8. For local pickup: provide exact dimensions and weight when prompted
9. Approve the final draft; Claude posts the listing(s) and returns the live URL(s)
10. The item folder moves to `listings/[item-name]/` with the full `item-log.md` updated

---

## Testing

Run the unit test suite (no real API calls — all mocked):

```bash
cd mcp-server
npm test                    # single run, all tests
npm run test:watch          # watch mode
npm run test:coverage       # with coverage report

# single file
npx vitest run src/__tests__/tools/createOffer.test.ts
```

**Smoke-testing the live integration:**

| What to verify | How |
|---|---|
| MCP server connects | Hammer icon appears in Claude Desktop after restart |
| eBay auth works | Ask Claude: "Call `ebay_search_listings` with keywords `vintage lamp`" |
| Etsy auth works | Ask Claude: "Call `etsy_get_taxonomy_nodes` with keyword `lamp`" |
| Vision/Gemini work | Drop a photo in `Inbox/` and run Phase 1 |
| Shipping listing posts | Run a full Phase 2 with a real item; delete the test listing from eBay afterward |
| Local pickup listing posts | Same, but select "local pickup only" in Step 7; confirm the listing shows local pickup in eBay and uses the pay-in-person payment policy |

> **Etsy:** There is no sandbox — test listings hit production. Delete any test listings from Etsy Shop Manager after verifying.
