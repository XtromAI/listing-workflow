# Listing Workflow

An AI-powered marketplace listing pipeline built on [Claude Desktop](https://claude.ai/download) and the [Model Context Protocol (MCP)](https://modelcontextprotocol.io). Drop product photos into an `Inbox/` folder, run a skill in Claude Desktop, and get research-backed drafts and live listings on eBay and/or Etsy — without writing a single listing by hand.

**What it does:**
- **Phase 1 — Research:** Analyzes photos with Google Vision and Gemini, searches eBay and Etsy for comparable sold listings, and saves a research summary + draft to a `drafts/` folder.
- **Phase 2 — Publish:** On your approval, posts the listing directly to eBay and/or Etsy via their APIs and moves the item folder to `listings/`.

## Repository Structure

```
listing-workflow/
├── mcp-server/          # Node.js/TypeScript MCP server — eBay & Etsy API tools
├── cowork-skill/
│   └── listing-workflow.md  # Claude skill prompt that drives the workflow
└── notification-handler/    # Google Cloud Function for eBay GDPR compliance
```

## Prerequisites

Before starting, you need accounts and credentials for all services you plan to use:

| Service | Required for | Where to get it |
|---|---|---|
| [Claude Desktop](https://claude.ai/download) (Pro or higher) | Running the workflow | claude.ai |
| [eBay Developer Account](https://developer.ebay.com) | eBay listings | developer.ebay.com |
| eBay seller account with business policies | Publishing eBay listings | eBay Seller Hub → Account → Business Policies |
| [Etsy Developer Account](https://www.etsy.com/developers/your-apps) | Etsy listings | etsy.com/developers |
| Etsy shop with shipping & return profiles set up | Publishing Etsy listings | Etsy Shop Manager |
| [Google Cloud project](https://console.cloud.google.com) with Vision API enabled | Image analysis | console.cloud.google.com |
| [Google AI Studio](https://ai.google.dev) account | Gemini research | ai.google.dev |
| Node.js 18+ | Building the MCP server | nodejs.org |

eBay and Etsy credentials each require completing an OAuth flow — see [Getting Credentials](#getting-credentials) below.

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/XtromAI/listing-workflow.git
cd listing-workflow/mcp-server
npm install
```

### 2. Create the working folders

The workflow expects these folders at the repository root:

```bash
mkdir Inbox drafts listings
```

Place product photos in `Inbox/` before running Phase 1.

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `mcp-server/.env` with your credentials. See [Getting Credentials](#getting-credentials) for how to obtain each value.

```env
# eBay
EBAY_CLIENT_ID=your_client_id
EBAY_CLIENT_SECRET=your_client_secret
EBAY_REFRESH_TOKEN=your_refresh_token
EBAY_RUNAME=your_runame
EBAY_ENVIRONMENT=production
EBAY_FULFILLMENT_POLICY_ID=your_policy_id
EBAY_PAYMENT_POLICY_ID=your_policy_id
EBAY_RETURN_POLICY_ID=your_policy_id
EBAY_MERCHANT_LOCATION_KEY=default-location

# Google Vision + Gemini
GOOGLE_VISION_API_KEY=your_key
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-2.0-flash

# Etsy
ETSY_API_KEY=your_etsy_api_key
ETSY_CLIENT_ID=your_etsy_api_key   # same value as ETSY_API_KEY
ETSY_REFRESH_TOKEN=your_refresh_token
ETSY_SHOP_ID=your_numeric_shop_id
ETSY_SHIPPING_PROFILE_ID=your_profile_id
ETSY_RETURN_POLICY_ID=your_policy_id
```

### 4. Build the MCP server

```bash
# from mcp-server/
npm run build
```

This compiles TypeScript to `mcp-server/build/index.js`.

### 5. Register with Claude Desktop

Open your Claude Desktop configuration file and add the server under `mcpServers`. All environment variables from your `.env` file must also appear in the `env` block — Claude Desktop spawns the process directly and does not load `.env`.

**Config file location:**

| Platform | Path |
|---|---|
| Windows (Store) | `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json` |
| Windows (direct install) | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |

**Example config:**

```json
{
  "mcpServers": {
    "listing-workflow": {
      "command": "node",
      "args": ["C:/path/to/listing-workflow/mcp-server/build/index.js"],
      "env": {
        "EBAY_CLIENT_ID": "your_client_id",
        "EBAY_CLIENT_SECRET": "your_client_secret",
        "EBAY_REFRESH_TOKEN": "your_refresh_token",
        "EBAY_RUNAME": "your_runame",
        "EBAY_ENVIRONMENT": "production",
        "EBAY_FULFILLMENT_POLICY_ID": "your_policy_id",
        "EBAY_PAYMENT_POLICY_ID": "your_policy_id",
        "EBAY_RETURN_POLICY_ID": "your_policy_id",
        "EBAY_MERCHANT_LOCATION_KEY": "default-location",
        "GOOGLE_VISION_API_KEY": "your_key",
        "GEMINI_API_KEY": "your_key",
        "GEMINI_MODEL": "gemini-2.0-flash",
        "ETSY_API_KEY": "your_etsy_api_key",
        "ETSY_CLIENT_ID": "your_etsy_api_key",
        "ETSY_REFRESH_TOKEN": "your_refresh_token",
        "ETSY_SHOP_ID": "your_numeric_shop_id",
        "ETSY_SHIPPING_PROFILE_ID": "your_profile_id",
        "ETSY_RETURN_POLICY_ID": "your_policy_id"
      }
    }
  }
}
```

Restart Claude Desktop after saving the config. You should see a hammer icon in the chat input area when the MCP server is connected.

### 6. Add the skill to Claude Desktop

Open `cowork-skill/listing-workflow.md` and add its contents as project instructions in Claude Desktop:

1. Open Claude Desktop and create or open a **Project**
2. Go to **Project instructions**
3. Paste the full contents of `listing-workflow.md` as the instructions

This gives Claude the two-phase workflow logic whenever you chat within that project.

### 7. One-time eBay setup

eBay requires a merchant location (item country) before listings can be published. Run this once via the MCP server — you can trigger it by asking Claude in a chat that has the MCP server connected:

> "Call `ebay_create_merchant_location` with key `default-location`"

Verify that `EBAY_MERCHANT_LOCATION_KEY` in your config matches the key you used (the default is `default-location`).

---

## Getting Credentials

### eBay

1. Create an app at [developer.ebay.com](https://developer.ebay.com) → **Get Started** → **Create Application**
2. Under **Credentials**, copy your **Production** `App ID` (Client ID) and `Cert ID` (Client Secret)
3. Add a **RuName** (redirect URL name) under User Tokens — this is your `EBAY_RUNAME`
4. Complete the OAuth authorization flow to get your `EBAY_REFRESH_TOKEN`:
   - Direct a browser to eBay's OAuth consent URL with your `client_id` and `RuName`
   - After authorizing, exchange the returned `code` for tokens using the eBay OAuth API
   - The `refresh_token` from that response is your `EBAY_REFRESH_TOKEN`
5. Create **Business Policies** in [eBay Seller Hub](https://www.ebay.com/sh/landing) → **Account** → **Business Policies**, and copy the numeric IDs for fulfillment, payment, and return policies

### Etsy

1. Create an app at [etsy.com/developers/your-apps](https://www.etsy.com/developers/your-apps) — your API key is `ETSY_API_KEY` (and `ETSY_CLIENT_ID`)
2. Complete the OAuth 2.0 PKCE flow to get your initial `ETSY_REFRESH_TOKEN`:
   - Request scopes: `listings_w listings_r`
3. Your shop's numeric ID is visible in the Etsy Shop Manager URL: `etsy.com/your-shop-name/tools/listings` — or use the Etsy API `getMe` endpoint
4. Shipping and return profile IDs are in **Shop Manager → Settings → Shipping** and **Returns**

> **Etsy refresh token rotation:** Etsy invalidates the refresh token on every use and issues a new one. The MCP server logs the new token to stderr after each refresh. You must update `ETSY_REFRESH_TOKEN` in both `mcp-server/.env` and your Claude Desktop config after every server restart — otherwise the next OAuth refresh will fail. If the token has expired (not refreshed in 90 days), you must re-run the full OAuth flow.

### Google

- **Vision API:** Enable it in [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services** → **Enable APIs** → search "Cloud Vision API". Create an API key under **Credentials**.
- **Gemini:** Get an API key from [Google AI Studio](https://ai.google.dev). Set `GEMINI_MODEL` to a valid Gemini model ID (e.g. `gemini-2.0-flash`).

---

## Usage

1. Drop one or more photos of an item into the `Inbox/` folder at the repo root
2. Open Claude Desktop in the listing-workflow project
3. Say: **"List an item"** (or similar)
4. Claude runs Phase 1 — analyzes photos, researches comps, presents a draft
5. Review the draft; approve or request changes
6. Say: **"Create the listing"** to trigger Phase 2
7. Select eBay, Etsy, or both; Claude posts and returns the live listing URL(s)

---

## MCP Tools Reference

### eBay tools
| Tool | Purpose |
|---|---|
| `ebay_get_category_suggestions` | Suggest category IDs from a keyword |
| `ebay_get_category_requirements` | Get required aspects and valid conditions for a category |
| `ebay_search_by_image` | Find similar eBay listings by image (requires Browse API approval) |
| `ebay_search_listings` | Search active or sold eBay listings by keyword |
| `google_vision_web_detection` | Run Google Vision web detection on a local image |
| `gemini_item_research` | Identify and research an item using Gemini |
| `ebay_upload_image` | Upload a local image to eBay's picture service |
| `ebay_create_inventory_item` | Create an inventory item (SKU) |
| `ebay_create_merchant_location` | One-time setup of a merchant location |
| `ebay_create_offer` | Create an offer for a SKU |
| `ebay_publish_offer` | Publish an offer as a live listing |

### Etsy tools
| Tool | Purpose |
|---|---|
| `etsy_get_taxonomy_nodes` | Search Etsy's taxonomy for a category |
| `etsy_get_taxonomy_node_properties` | Get required properties for a taxonomy node |
| `etsy_create_draft_listing` | Create a draft listing |
| `etsy_upload_listing_image` | Attach a local image to a draft listing |
| `etsy_publish_listing` | Publish a draft listing |

---

## Testing

Tests use [Vitest](https://vitest.dev) and mock `axios` and the auth modules — no real API calls are made during unit tests. Run from `mcp-server/`:

```bash
npm test                # single run
npm run test:watch      # watch mode
npm run test:coverage   # coverage report
```

Run a single test file:

```bash
npx vitest run src/__tests__/tools/createOffer.test.ts
```

> **Note:** There is no Etsy sandbox. Any Etsy API calls made outside of unit tests hit production. Delete test listings from Etsy Shop Manager afterward.

---

## Known Limitations

- **eBay image search (`ebay_search_by_image`)** requires eBay Browse API production eligibility, which is not self-service. If access is not granted, the workflow falls back to Google Vision + Gemini automatically.
- **eBay condition codes** use the Inventory API format (`USED_EXCELLENT`, `USED_GOOD`, etc.), which differs from the legacy Trading API codes. The skill always calls `ebay_get_category_requirements` first to get the valid set for a given category.
- **Etsy refresh token rotation** (see above) means manual token updates are required after server restarts.
- The workflow is designed for **individual item listings** — it processes one item per Phase 1/2 cycle.

---

## eBay Notification Handler (Compliance)

eBay requires marketplace sellers to handle account-deletion notifications under GDPR/CCPA. The `notification-handler/` folder contains a standalone Google Cloud Function gen2 deployment (plain JS) that satisfies this requirement.

This is a one-time deployment — you only need it if you are registering a production eBay app:

```bash
cd notification-handler
npm run deploy:first   # first deploy (creates the function)
npm run deploy         # subsequent redeploys
```

Its environment variables (`EBAY_VERIFICATION_TOKEN`, `NOTIFICATION_ENDPOINT_URL`) are set via `gcloud --set-env-vars` and are separate from the MCP server `.env`.

---

## License

MIT
