# eBay AI Listing Agent — Implementation Plan

## Project Overview

An automated eBay listing tool that accepts photos as input, uses AI to research and
generate listing content, presents a draft for human approval, and posts the final
listing to eBay via API. Implemented as a Claude Cowork skill backed by a locally
hosted eBay MCP server.

---

## Repository Structure

```
ebay-ai-listing-agent/
├── mcp-server/                  # eBay MCP server (Node.js)
│   ├── src/
│   │   ├── index.ts             # Entry point, MCP server setup
│   │   ├── tools/
│   │   │   ├── uploadImage.ts   # eBay Media API
│   │   │   ├── createItem.ts    # Inventory API - createOrReplaceInventoryItem
│   │   │   ├── createOffer.ts   # Inventory API - createOffer
│   │   │   ├── publishOffer.ts  # Inventory API - publishOffer
│   │   │   ├── getCategories.ts # Taxonomy API - getCategorySuggestions
│   │   │   └── searchByImage.ts # Browse API - searchByImage
│   │   ├── auth/
│   │   │   ├── oauth.ts         # OAuth 2.0 token management
│   │   │   └── refresh.ts       # Token refresh logic
│   │   └── types/
│   │       └── ebay.ts          # Shared TypeScript types
│   ├── build/                   # Compiled output (gitignored)
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example             # Template for credentials
├── cowork-skill/
│   └── ebay-listing-skill.md    # The Cowork skill prompt
├── docs/
│   └── oauth-setup.md           # Step-by-step eBay OAuth guide
└── README.md
```

---

## Phase 1 — eBay Developer Account Setup

### 1.1 Register as an eBay Developer

1. Go to [https://developer.ebay.com](https://developer.ebay.com) and sign in with your eBay seller account.
2. Navigate to **My Account > Application Keysets**.
3. Click **Create a Keyset** and choose **Production**.
4. Name the app (e.g. `listing-workflow`).
5. Note down:
   - `App ID (Client ID)`
   - `Cert ID (Client Secret)`
   - `Dev ID`

### 1.2 Configure OAuth Redirect URI

1. In the developer portal, go to **User Tokens > Get a Token from eBay via Your Application**.
2. Add a **RuName (eBay Redirect URL Name)** — for local use, set the redirect URI to `https://localhost`.
3. Save the RuName string — you will need it during the OAuth flow.

### 1.3 Required OAuth Scopes

Request the following scopes when setting up your OAuth application:

```
https://api.ebay.com/oauth/api_scope
https://api.ebay.com/oauth/api_scope/sell.inventory
https://api.ebay.com/oauth/api_scope/sell.inventory.readonly
https://api.ebay.com/oauth/api_scope/sell.account
https://api.ebay.com/oauth/api_scope/sell.fulfillment
```

### 1.4 Complete the OAuth Flow (One-Time)

1. Construct the authorization URL:
   ```
   https://auth.ebay.com/oauth2/authorize
     ?client_id=YOUR_CLIENT_ID
     &redirect_uri=YOUR_RUNAME
     &response_type=code
     &scope=https://api.ebay.com/oauth/api_scope/sell.inventory
   ```
2. Open the URL in your browser. Log in and authorize the app.
3. eBay redirects to your redirect URI with a `code` parameter in the URL. Copy it.
4. Exchange the code for tokens via POST:
   ```bash
   curl -X POST https://api.ebay.com/identity/v1/oauth2/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -H "Authorization: Basic BASE64(CLIENT_ID:CLIENT_SECRET)" \
     -d "grant_type=authorization_code&code=YOUR_CODE&redirect_uri=YOUR_RUNAME"
   ```
5. Save the `refresh_token` from the response. This is your long-lived credential.

### 1.5 Enable Business Policies

The Inventory API requires Business Policies to be active on your seller account.

1. Go to [https://www.ebay.com/bmgt/BizSettings](https://www.ebay.com/bmgt/BizSettings).
2. Enable **Business Policies**.
3. Create at least one policy for each of:
   - **Payment** (Managed Payments — just accept the default)
   - **Shipping** (e.g. USPS First Class, calculated shipping)
   - **Returns** (e.g. 30-day returns)
4. Note down the `policyId` for each — you will pass these into `createOffer`.

### 1.6 Apply for Browse API Production Access (for image search)

The `searchByImage` endpoint requires special approval.

1. In the developer portal go to **APIs > Browse API**.
2. Submit an access request describing your use case (personal seller tool).
3. This may take several days. In the meantime, Step 3 of the workflow falls back to
   Claude web search, which works immediately with no approval required.

---

## Phase 2 — MCP Server Implementation

### 2.1 Initialize the Project

```bash
mkdir mcp-server && cd mcp-server
npm init -y
npm install @modelcontextprotocol/sdk axios dotenv
npm install --save-dev typescript @types/node ts-node
npx tsc --init
```

Set `tsconfig.json` to target `ES2020` with `outDir: "./build"`.

### 2.2 Environment Variables

Create `.env` (never commit this file):

```env
EBAY_CLIENT_ID=your_client_id
EBAY_CLIENT_SECRET=your_client_secret
EBAY_REFRESH_TOKEN=your_refresh_token
EBAY_RUNAME=your_runame
EBAY_ENVIRONMENT=production
GOOGLE_VISION_API_KEY=your_google_vision_key
```

Create `.env.example` with the same keys but empty values. Commit `.env.example`, not `.env`.

### 2.3 OAuth Token Manager (`src/auth/oauth.ts`)

Implement a token manager that:

- Accepts the refresh token from the environment.
- Calls `POST https://api.ebay.com/identity/v1/oauth2/token` with
  `grant_type=refresh_token` to get a fresh access token.
- Caches the access token in memory with its expiry time.
- Auto-refreshes before expiry on every API call.

```typescript
// Key function signature
async function getAccessToken(): Promise<string>
```

### 2.4 MCP Server Entry Point (`src/index.ts`)

Set up the MCP server using the `@modelcontextprotocol/sdk` package:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
  { name: "ebay-listing-agent", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Register all tools here (see 2.5 below)

const transport = new StdioServerTransport();
await server.connect(transport);
```

### 2.5 MCP Tools to Implement

Each tool is registered on the server and maps to one eBay API call.

---

#### Tool: `ebay_get_category_suggestions`

**Purpose:** Given an item title, return the best matching eBay category ID.

**eBay API:** `GET https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_suggestions`

**Input schema:**
```json
{
  "query": "string — item title or description"
}
```

**Returns:** Array of `{ categoryId, categoryName, fullPath }` sorted by relevance.

---

#### Tool: `ebay_search_by_image`

**Purpose:** Submit a base64 image to eBay and return visually similar active listings with prices.

**eBay API:** `POST https://api.ebay.com/buy/browse/v1/item_summary/search_by_image`

**Input schema:**
```json
{
  "imageBase64": "string — base64 encoded image",
  "limit": "number — max results, default 10"
}
```

**Returns:** Array of `{ title, price, condition, itemWebUrl, image }`.

**Note:** Only works after Browse API production access is approved. Return a
clear error message if access is not yet granted so the skill can fall back gracefully.

---

#### Tool: `google_vision_web_detection`

**Purpose:** Submit an image to Google Vision API to identify the item and find matching web pages.

**Google API:** `POST https://vision.googleapis.com/v1/images:annotate`

Feature requested: `WEB_DETECTION`

**Input schema:**
```json
{
  "imageBase64": "string — base64 encoded image"
}
```

**Returns:**
```json
{
  "bestGuessLabels": ["string"],
  "webEntities": [{ "description": "string", "score": "number" }],
  "pagesWithMatchingImages": [{ "url": "string", "pageTitle": "string" }]
}
```

---

#### Tool: `ebay_upload_image`

**Purpose:** Upload a photo to eBay's image hosting and return the hosted image URL.

**eBay API:** `POST https://api.ebay.com/sell/media/v1/image`

**Input schema:**
```json
{
  "imageBase64": "string — base64 encoded image",
  "imageType": "string — JPEG or PNG"
}
```

**Returns:** `{ imageUrl: string }`

---

#### Tool: `ebay_create_inventory_item`

**Purpose:** Create an inventory item record in eBay's system.

**eBay API:** `PUT https://api.ebay.com/sell/inventory/v1/inventory_item/{sku}`

**Input schema:**
```json
{
  "sku": "string — unique identifier you generate (e.g. timestamp-based)",
  "title": "string",
  "description": "string — HTML allowed",
  "condition": "string — USED_EXCELLENT | USED_GOOD | USED_ACCEPTABLE | NEW | etc.",
  "conditionDescription": "string — optional detail about condition",
  "imageUrls": ["string — from ebay_upload_image"],
  "brand": "string",
  "mpn": "string — optional manufacturer part number"
}
```

**Returns:** HTTP 204 on success (no body). Throw a descriptive error on failure.

---

#### Tool: `ebay_create_offer`

**Purpose:** Attach a price, category, and shipping policy to the inventory item.

**eBay API:** `POST https://api.ebay.com/sell/inventory/v1/offer`

**Input schema:**
```json
{
  "sku": "string — must match the SKU from ebay_create_inventory_item",
  "categoryId": "string — from ebay_get_category_suggestions",
  "price": "number",
  "currency": "string — USD",
  "quantity": "number — default 1",
  "listingDescription": "string — HTML",
  "fulfillmentPolicyId": "string — from Business Policies setup",
  "paymentPolicyId": "string — from Business Policies setup",
  "returnPolicyId": "string — from Business Policies setup",
  "listingFormat": "FIXED_PRICE"
}
```

**Returns:** `{ offerId: string }`

---

#### Tool: `ebay_publish_offer`

**Purpose:** Make the offer live as a public eBay listing.

**eBay API:** `POST https://api.ebay.com/sell/inventory/v1/offer/{offerId}/publish`

**Input schema:**
```json
{
  "offerId": "string — from ebay_create_offer"
}
```

**Returns:** `{ listingId: string, listingUrl: string }`

---

### 2.6 Build and Test in Sandbox

Before pointing at production, test against eBay's sandbox environment:

- Use `api.sandbox.ebay.com` instead of `api.ebay.com`
- Get sandbox credentials from the developer portal (separate from production keys)
- Run through the full flow with a test item to verify each tool works end to end

```bash
npm run build
node build/index.js   # Should start without errors
```

---

## Phase 3 — Claude Desktop Configuration

### 3.1 Locate the Config File

- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

### 3.2 Add the MCP Server Entry

```json
{
  "mcpServers": {
    "ebay-listing-agent": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/build/index.js"],
      "env": {
        "EBAY_CLIENT_ID": "your_client_id",
        "EBAY_CLIENT_SECRET": "your_client_secret",
        "EBAY_REFRESH_TOKEN": "your_refresh_token",
        "EBAY_RUNAME": "your_runame",
        "EBAY_ENVIRONMENT": "production",
        "GOOGLE_VISION_API_KEY": "your_google_vision_key"
      }
    }
  }
}
```

Use the absolute path to the built `index.js`. Do not use `~` or relative paths.

### 3.3 Verify Connection

1. Restart Claude Desktop.
2. Open a new conversation.
3. Type: `List the available tools from the ebay-listing-agent MCP server.`
4. Claude should enumerate all the tools defined in Phase 2.5.

---

## Phase 4 — Google Vision API Setup

### 4.1 Enable the API

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com).
2. Create a new project (e.g. `ebay-listing-agent`).
3. Navigate to **APIs & Services > Library**.
4. Search for **Cloud Vision API** and click **Enable**.

### 4.2 Create an API Key

1. Go to **APIs & Services > Credentials**.
2. Click **Create Credentials > API Key**.
3. Copy the key and add it to your `.env` as `GOOGLE_VISION_API_KEY`.
4. Optionally restrict the key to only the Cloud Vision API for security.

### 4.3 Verify Free Tier

The first 1,000 `WEB_DETECTION` requests per month are free. At personal listing
volumes this limit will not be reached. Set up a billing alert at $1.00 in the
Google Cloud Console as a safety net.

---

## Phase 5 — Cowork Skill

### 5.1 Skill Prompt

Create the skill in Cowork with the following instructions. This single skill
orchestrates the entire workflow.

---

**Skill name:** `List Item on eBay`

**Skill instructions:**

```
You are an eBay listing assistant. When the user uploads photos of an item, follow
these steps in order. Be thorough at each step before proceeding to the next.

STEP 1 — IDENTIFY THE ITEM
Examine all uploaded photos carefully using your vision. Identify:
- Item type, brand, model, edition or version
- Approximate age or era
- Condition (note any visible damage, wear, or defects)
- Notable features, materials, dimensions if estimable
- Any text, serial numbers, model numbers visible in the photos

STEP 2 — REVERSE IMAGE RESEARCH
Call ebay_search_by_image with the primary photo (base64 encoded).
If this tool returns an error due to API access, skip to Step 3.

Call google_vision_web_detection with the primary photo.
Use the returned webEntities and bestGuessLabels to confirm the item identity.

STEP 3 — MARKET RESEARCH
Use your web search capability to find:
- Current sold listings on eBay for this exact item (search "site:ebay.com [item name]
  sold")
- Typical sold price range (low, average, high)
- Current active listings and their asking prices
- Original retail price if applicable

STEP 4 — GET CATEGORY
Call ebay_get_category_suggestions using a concise version of the item title.
Select the most specific and appropriate category from the results.

STEP 5 — DRAFT THE LISTING
Compile all research into a listing draft with these fields:

**TITLE:** [80 characters max, include brand + model + key attributes + condition]
**CATEGORY:** [category name and ID]
**CONDITION:** [one of: NEW, LIKE_NEW, USED_EXCELLENT, USED_GOOD, USED_ACCEPTABLE]
**CONDITION NOTES:** [1-2 sentences describing actual condition]
**PRICE:** $[recommended price] (research range: $[low] – $[high])
**DESCRIPTION:**
[HTML-formatted, 3-4 paragraphs covering: what the item is, key features,
condition details, what is included, shipping notes]

**ITEM SPECIFICS:**
- Brand: [value]
- Model: [value]
- [Any other relevant specifics]

STEP 6 — PRESENT FOR APPROVAL
Show the complete draft to the user and ask:
"Does this look correct? You can approve it, ask me to adjust any field, or cancel."

Wait for the user's response before proceeding.

STEP 7 — UPLOAD PHOTOS AND POST (only after explicit approval)
For each photo:
  Call ebay_upload_image to get the hosted eBay image URL.

Generate a unique SKU: "item-[YYYYMMDD]-[random 4 digits]"

Call ebay_create_inventory_item with the approved details and image URLs.

Call ebay_create_offer with the approved price, category, and your stored
Business Policy IDs:
  - fulfillmentPolicyId: [INSERT YOUR POLICY ID]
  - paymentPolicyId: [INSERT YOUR POLICY ID]
  - returnPolicyId: [INSERT YOUR POLICY ID]

Call ebay_publish_offer with the returned offerId.

STEP 8 — CONFIRM
Return the live listing URL to the user.
```

---

### 5.2 Hardcoding Business Policy IDs

Before using the skill, replace the three `[INSERT YOUR POLICY ID]` placeholders
in the skill instructions with the actual policy IDs from your eBay seller account.

To find them:
```bash
curl -X GET https://api.ebay.com/sell/account/v1/fulfillment_policy \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "X-EBAY-C-MARKETPLACE-ID: EBAY_US"
```

Run similar calls for `/return_policy` and `/payment_policy`.

---

## Phase 6 — End-to-End Test

### 6.1 Sandbox Test Run

1. Ensure `EBAY_ENVIRONMENT=sandbox` in your `.env`.
2. Open Cowork and trigger the skill with a test photo.
3. Verify each step completes and the tool calls appear in Claude's reasoning.
4. Confirm a sandbox listing is created in the eBay sandbox seller hub.

### 6.2 Switch to Production

1. Change `EBAY_ENVIRONMENT=production` in `.env` and in `claude_desktop_config.json`.
2. Restart Claude Desktop.
3. Run a real listing with a low-value item to verify the full flow end-to-end.
4. Confirm the listing appears live on eBay.

---

## Appendix A — API Reference Summary

| Tool | eBay API | Endpoint |
|---|---|---|
| `ebay_get_category_suggestions` | Taxonomy API | `GET /commerce/taxonomy/v1/category_tree/0/get_category_suggestions` |
| `ebay_search_by_image` | Browse API | `POST /buy/browse/v1/item_summary/search_by_image` |
| `google_vision_web_detection` | Google Vision API | `POST https://vision.googleapis.com/v1/images:annotate` |
| `ebay_upload_image` | Media API | `POST /sell/media/v1/image` |
| `ebay_create_inventory_item` | Inventory API | `PUT /sell/inventory/v1/inventory_item/{sku}` |
| `ebay_create_offer` | Inventory API | `POST /sell/inventory/v1/offer` |
| `ebay_publish_offer` | Inventory API | `POST /sell/inventory/v1/offer/{offerId}/publish` |

---

## Appendix B — eBay Item Condition Codes

| Condition | eBay Code | Use When |
|---|---|---|
| New | `NEW` | Unused, original packaging |
| Like New | `LIKE_NEW` | Unused or barely used, no defects |
| Very Good | `VERY_GOOD` | Light use, minor cosmetic issues |
| Good | `GOOD` | Normal use, some wear visible |
| Acceptable | `ACCEPTABLE` | Heavy use, fully functional |
| For Parts | `FOR_PARTS_OR_NOT_WORKING` | Not fully functional |

---

## Appendix C — Future Enhancements

- **Etsy cross-posting:** After eBay approval, draft a parallel Etsy listing using
  the same research. Requires Etsy OAuth and the Etsy v3 API.
- **Listing management skill:** A second Cowork skill to check listing status,
  update prices, or end listings via the eBay Inventory API.
- **Draft storage:** Log all generated listings to a local JSON file or SQLite
  database for record-keeping and relisting.
- **Mobile support:** Deploy the MCP server to Railway or Render to enable use from
  the Claude mobile app.
