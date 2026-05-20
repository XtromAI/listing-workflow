# eBay AI Listing Agent — Implementation Plan (Corrected)

## What This Replaces

This is a corrected version of `docs/ebay-ai-listing-agent-plan.md`. Key differences:
- Image pipeline uses **file paths** instead of unresolvable base64 from Claude's vision
- Condition codes corrected to Inventory API format (`VERY_GOOD`, not `USED_EXCELLENT`)
- `itemSpecifics` added to inventory item tool schema
- Business policy IDs moved from hardcoded skill text to **env vars**
- Google Vision setup moved before MCP server (need key while coding)
- `sell.fulfillment` OAuth scope removed (unused)
- `dotenv` reconciled with Claude Desktop env injection
- `.gitignore` and `build` npm script added

---

## Project Overview

A Cowork skill backed by a locally-hosted Node.js/TypeScript MCP server that:
1. Accepts local photo file paths as input
2. Uses AI + Google Vision + eBay APIs to research and generate listing content
3. Presents a draft for human approval
4. Posts the approved listing to eBay automatically

---

## Repository Structure

```
listing-workflow/
├── mcp-server/
│   ├── src/
│   │   ├── index.ts
│   │   ├── auth/
│   │   │   └── oauth.ts
│   │   ├── tools/
│   │   │   ├── getCategories.ts
│   │   │   ├── searchByImage.ts
│   │   │   ├── visionDetect.ts
│   │   │   ├── uploadImage.ts
│   │   │   ├── createItem.ts
│   │   │   ├── createOffer.ts
│   │   │   └── publishOffer.ts
│   │   └── types/
│   │       └── ebay.ts
│   ├── .env              (gitignored)
│   ├── .env.example
│   ├── .gitignore
│   ├── package.json
│   └── tsconfig.json
├── notification-handler/         (Google Cloud Function — eBay compliance)
│   ├── index.ts
│   ├── package.json
│   └── tsconfig.json
├── cowork-skill/
│   └── ebay-listing-skill.md
└── docs/
    └── ebay-ai-listing-agent-plan.md  (original, superseded)
```

---

## Phase 1 — Prerequisites

### 1.1 eBay Compliance Endpoint (Marketplace Account Deletion)

eBay requires all keysets — including personal ones — to register an HTTPS endpoint that receives account deletion/closure notifications (GDPR/CCPA compliance). Without this, the keyset is created in a disabled state. This is a one-time setup using a Google Cloud Function deployed to the same project as Vision API.

#### Deploy the Cloud Function

Create `notification-handler/index.ts`:

```typescript
import { http } from '@google-cloud/functions-framework';
import * as crypto from 'crypto';

http('ebayNotifications', (req, res) => {
  if (req.method === 'GET') {
    const challenge = req.query.challenge_code as string;
    const hash = crypto.createHash('sha256')
      .update(challenge + process.env.EBAY_VERIFICATION_TOKEN! + process.env.NOTIFICATION_ENDPOINT_URL!)
      .digest('hex');
    return res.status(200).json({ challengeResponse: hash });
  }
  res.status(200).send('OK');
});
```

Create `notification-handler/package.json`:

```json
{
  "main": "index.js",
  "dependencies": {
    "@google-cloud/functions-framework": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  },
  "scripts": { "build": "tsc" }
}
```

Set `notification-handler/tsconfig.json`: target `ES2020`, `module: commonjs`, `outDir: "./"`, `strict: true`.

#### Two-Step Deploy (URL is only known after first deploy)

```bash
cd notification-handler
npm install
npm run build

# Step 1 — deploy without env vars to get the function URL
gcloud functions deploy ebay-notifications \
  --gen2 \
  --runtime=nodejs22 \
  --trigger-http \
  --allow-unauthenticated \
  --region=us-central1 \
  --source=.
```

Copy the URL from the output (format: `https://us-central1-PROJECT_ID.cloudfunctions.net/ebay-notifications`).

#### Register in eBay Developer Portal

1. Go to **My Account > Alerts & Notifications > Marketplace Account Deletion**.
2. Enter the function URL and choose a random verification token string (save it — you'll need it in the next step).
3. Save. eBay will send a verification GET request to your endpoint.

#### Redeploy with Env Vars

```bash
# Step 2 — redeploy with the token and URL so the challenge hash works
gcloud functions deploy ebay-notifications \
  --gen2 \
  --runtime=nodejs22 \
  --trigger-http \
  --allow-unauthenticated \
  --region=us-central1 \
  --source=. \
  --set-env-vars="EBAY_VERIFICATION_TOKEN=your_random_token,NOTIFICATION_ENDPOINT_URL=https://YOUR_FUNCTION_URL"
```

eBay retries the verification challenge — your function responds correctly, the keyset becomes compliant and is enabled.

---

### 1.2 Google Cloud Vision API

Do this first — the API key is needed when coding the MCP server.

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com) and create a project (e.g. `ebay-listing-agent`).
2. Navigate to **APIs & Services > Library**, search **Cloud Vision API**, click **Enable**.
3. Go to **APIs & Services > Credentials > Create Credentials > API Key**. Copy the key.
4. Optionally restrict the key to Cloud Vision API only.
5. Free tier: 1,000 `WEB_DETECTION` calls/month. Set a $1 billing alert as a safety net.

### 1.3 eBay Developer Account Setup

#### Register and Create a Keyset
1. Sign in at [https://developer.ebay.com](https://developer.ebay.com) with your seller account.
2. **My Account > Application Keysets > Create a Keyset > Production**.
3. Name it `listing-workflow`. Note down: `App ID (Client ID)`, `Cert ID (Client Secret)`, `Dev ID`.

#### Configure OAuth Redirect URI
1. **User Tokens > Get a Token from eBay via Your Application**.
2. Add a **RuName** with redirect URI `https://localhost`.
3. Save the RuName string.

#### Required OAuth Scopes
```
https://api.ebay.com/oauth/api_scope
https://api.ebay.com/oauth/api_scope/sell.inventory
https://api.ebay.com/oauth/api_scope/sell.inventory.readonly
```
No others are needed. `sell.account` and `sell.fulfillment` are not required by any tool.

#### Complete the OAuth Flow (One-Time)
1. Construct the authorization URL and open it in your browser:
   ```
   https://auth.ebay.com/oauth2/authorize
     ?client_id=YOUR_CLIENT_ID
     &redirect_uri=YOUR_RUNAME
     &response_type=code
     &scope=https://api.ebay.com/oauth/api_scope%20https://api.ebay.com/oauth/api_scope/sell.inventory
   ```
2. Authorize the app. Copy the `code` from the redirect URL.
3. Exchange for tokens:
   ```bash
   curl -X POST https://api.ebay.com/identity/v1/oauth2/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -H "Authorization: Basic BASE64(CLIENT_ID:CLIENT_SECRET)" \
     -d "grant_type=authorization_code&code=YOUR_CODE&redirect_uri=YOUR_RUNAME"
   ```
4. Save the `refresh_token` — this is your long-lived credential.

#### Enable Business Policies
1. Go to [https://www.ebay.com/bmgt/BizSettings](https://www.ebay.com/bmgt/BizSettings) and enable **Business Policies**.
2. Create one policy for each: Payment (accept Managed Payments default), Shipping, Returns.

#### Find Your Business Policy IDs
Find the IDs in the eBay Seller Hub UI:
1. Go to [https://www.ebay.com/bmgt/BizSettings](https://www.ebay.com/bmgt/BizSettings).
2. Click each policy and note its numeric ID from the URL or page details.

These go into your `.env` (see Phase 2.2).

#### Apply for Browse API (Optional, for image search)
The `searchByImage` endpoint requires special access. Submit a request in the developer portal under **APIs > Browse API**. Until approved, the skill falls back to Google Vision + web search — no functionality is lost.

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

Add to `package.json` scripts:
```json
{
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/index.ts"
  }
}
```

Set `tsconfig.json`: target `ES2020`, `module: commonjs`, `outDir: "./build"`, `strict: true`.

Create `.gitignore`:
```
build/
.env
node_modules/
```

### 2.2 Environment Variables

Create `.env` (never commit):
```env
EBAY_CLIENT_ID=your_client_id
EBAY_CLIENT_SECRET=your_client_secret
EBAY_REFRESH_TOKEN=your_refresh_token
EBAY_RUNAME=your_runame
EBAY_ENVIRONMENT=production

EBAY_FULFILLMENT_POLICY_ID=your_policy_id
EBAY_PAYMENT_POLICY_ID=your_policy_id
EBAY_RETURN_POLICY_ID=your_policy_id

GOOGLE_VISION_API_KEY=your_google_vision_key

# Set in the Cloud Function via gcloud --set-env-vars, not needed in mcp-server .env
# EBAY_VERIFICATION_TOKEN=your_random_token
# NOTIFICATION_ENDPOINT_URL=https://us-central1-PROJECT_ID.cloudfunctions.net/ebay-notifications
```

Create `.env.example` with the same keys, empty values. Commit `.env.example` only.

### 2.3 OAuth Token Manager (`src/auth/oauth.ts`)

```typescript
import axios from "axios";

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }
  const { EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REFRESH_TOKEN } = process.env;
  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");
  const baseUrl = process.env.EBAY_ENVIRONMENT === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";

  const response = await axios.post(
    `${baseUrl}/identity/v1/oauth2/token`,
    `grant_type=refresh_token&refresh_token=${EBAY_REFRESH_TOKEN}`,
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );
  cachedToken = response.data.access_token;
  tokenExpiresAt = Date.now() + response.data.expires_in * 1000;
  return cachedToken!;
}
```

### 2.4 Server Entry Point (`src/index.ts`)

```typescript
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
// import each tool handler here

const server = new Server(
  { name: "ebay-listing-agent", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  // dispatch to tool handlers
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

Note: `import "dotenv/config"` is a no-op when env vars are already set (e.g. via Claude Desktop config), so this works correctly in both local dev and production.

### 2.5 Tool Implementations

**Image pipeline:** All tools that need image data accept a local `imagePath: string` (absolute path to a JPEG or PNG file). The MCP server reads the file from disk and encodes it as base64 internally. This avoids any base64 handling in the skill prompt and works reliably in the Claude Desktop context.

---

#### Tool: `ebay_get_category_suggestions`

**API:** `GET https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_suggestions`

**Input schema:**
```json
{ "query": "string — item title or description" }
```

**Returns:** Array of `{ categoryId, categoryName, fullPath }` sorted by relevance.

---

#### Tool: `ebay_search_by_image`

**API:** `POST https://api.ebay.com/buy/browse/v1/item_summary/search_by_image`

**Input schema:**
```json
{
  "imagePath": "string — absolute path to JPEG or PNG file",
  "limit": "number — max results, default 10"
}
```

**Server reads** the file, base64-encodes it, posts to eBay.

**Returns:** Array of `{ title, price, condition, itemWebUrl }`.

**Error handling:** If eBay returns 403 (access not approved), return `{ error: "Browse API access not yet approved — use web search fallback" }` so the skill can continue gracefully.

---

#### Tool: `google_vision_web_detection`

**API:** `POST https://vision.googleapis.com/v1/images:annotate`

**Input schema:**
```json
{ "imagePath": "string — absolute path to JPEG or PNG file" }
```

**Server reads** the file, encodes as base64, posts with feature type `WEB_DETECTION`.

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

**API:** `POST https://api.ebay.com/sell/media/v1/image`

**Input schema:**
```json
{ "imagePath": "string — absolute path to JPEG or PNG file" }
```

**Server reads** the file, detects type from extension (`.jpg`/`.jpeg` → `JPEG`, `.png` → `PNG`), uploads to eBay.

**Returns:** `{ imageUrl: string }`

---

#### Tool: `ebay_create_inventory_item`

**API:** `PUT https://api.ebay.com/sell/inventory/v1/inventory_item/{sku}`

**Input schema:**
```json
{
  "sku": "string — unique ID you generate",
  "title": "string — 80 chars max",
  "description": "string — HTML",
  "condition": "string — NEW | LIKE_NEW | VERY_GOOD | GOOD | ACCEPTABLE | FOR_PARTS_OR_NOT_WORKING",
  "conditionDescription": "string — optional, 1-2 sentence detail",
  "imageUrls": ["string — from ebay_upload_image"],
  "itemSpecifics": "object — key/value pairs, e.g. { Brand: 'Sony', Model: 'WH-1000XM4' }"
}
```

Maps to eBay's `product.title`, `product.description`, `product.aspects`, `product.imageUrls`, `condition`, `conditionDescription`.

**Returns:** HTTP 204 on success (no body). Throw with eBay's error message on failure.

---

#### Tool: `ebay_create_offer`

**API:** `POST https://api.ebay.com/sell/inventory/v1/offer`

Policy IDs (`fulfillmentPolicyId`, `paymentPolicyId`, `returnPolicyId`) are **read from env vars** by the server — they are not parameters. This keeps them out of the skill prompt and makes the tool simpler to call.

**Input schema:**
```json
{
  "sku": "string — must match ebay_create_inventory_item",
  "categoryId": "string — from ebay_get_category_suggestions",
  "price": "number",
  "currency": "string — USD",
  "quantity": "number — default 1",
  "listingDescription": "string — HTML, use same content as description in inventory item"
}
```

`listingFormat` is always `FIXED_PRICE`; hardcoded in the implementation, not a parameter.

**Returns:** `{ offerId: string }`

---

#### Tool: `ebay_publish_offer`

**API:** `POST https://api.ebay.com/sell/inventory/v1/offer/{offerId}/publish`

**Input schema:**
```json
{ "offerId": "string — from ebay_create_offer" }
```

**Returns:** `{ listingId: string, listingUrl: string }`

---

### 2.6 Build and Sandbox Test

```bash
npm run build
node build/index.js   # should start and wait without error
```

Before going to production, set `EBAY_ENVIRONMENT=sandbox` and use sandbox credentials (separate keyset from developer portal). Run through the full flow to verify each tool.

---

## Phase 3 — Claude Desktop Configuration

### 3.1 Config File Location

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`

### 3.2 Add the MCP Server Entry

Env vars set here override `.env` (dotenv is a no-op when vars are already present). Use the absolute path to `build/index.js` — no `~` or relative paths.

```json
{
  "mcpServers": {
    "ebay-listing-agent": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\mcp-server\\build\\index.js"],
      "env": {
        "EBAY_CLIENT_ID": "your_client_id",
        "EBAY_CLIENT_SECRET": "your_client_secret",
        "EBAY_REFRESH_TOKEN": "your_refresh_token",
        "EBAY_RUNAME": "your_runame",
        "EBAY_ENVIRONMENT": "production",
        "EBAY_FULFILLMENT_POLICY_ID": "your_policy_id",
        "EBAY_PAYMENT_POLICY_ID": "your_policy_id",
        "EBAY_RETURN_POLICY_ID": "your_policy_id",
        "GOOGLE_VISION_API_KEY": "your_google_vision_key"
      }
    }
  }
}
```

### 3.3 Verify Connection

1. Restart Claude Desktop.
2. New conversation: `List the available tools from the ebay-listing-agent MCP server.`
3. Claude should enumerate all 7 tools from Phase 2.5.

---

## Phase 4 — Cowork Skill

### Skill Name: `List Item on eBay`

```
You are an eBay listing assistant. When the user wants to list an item, ask them to
provide the absolute file path(s) to their photos (e.g. C:\Users\...\photo.jpg).
Then follow these steps in order.

STEP 1 — IDENTIFY THE ITEM
Examine the file path(s) provided. Use your knowledge of item types to ask the user
clarifying questions if needed:
- Item type, brand, model, edition or version
- Approximate age or era
- Condition (ask the user to describe any damage, wear, or defects)
- Any serial numbers, model numbers, or text on the item
- What is included (box, cables, accessories, etc.)

STEP 2 — REVERSE IMAGE RESEARCH
Call ebay_search_by_image with the primary photo path.
If it returns an error (Browse API not approved), note that and continue.

Call google_vision_web_detection with the primary photo path.
Use bestGuessLabels and webEntities to confirm item identity and exact model.

STEP 3 — MARKET RESEARCH
Use web search to find:
- eBay sold listings for this item (search: site:ebay.com/sch [item name] &LH_Sold=1)
- Typical sold price range (low, average, high)
- Current active listing prices
- Original retail price if available

STEP 4 — GET CATEGORY
Call ebay_get_category_suggestions using a concise version of the item title.
Select the most specific applicable category.

STEP 5 — DRAFT THE LISTING
Compile research into a draft:

TITLE: [80 chars max — Brand + Model + key attributes + condition keyword]
CATEGORY: [name — ID]
CONDITION: [one of: NEW | LIKE_NEW | VERY_GOOD | GOOD | ACCEPTABLE | FOR_PARTS_OR_NOT_WORKING]
CONDITION NOTES: [1-2 sentences about actual visible state]
PRICE: $[recommended] (sold range: $[low]–$[high])
DESCRIPTION:
[HTML — 3-4 paragraphs: what it is, key features, condition detail, what's included, shipping note]

ITEM SPECIFICS:
- Brand: [value]
- Model: [value]
- [Any other category-relevant specifics]

STEP 6 — PRESENT FOR APPROVAL
Show the complete draft and ask:
"Does this look correct? Approve to post, or tell me what to change."

Wait for explicit approval before proceeding. Do not call any posting tools yet.

STEP 7 — UPLOAD AND POST (only after explicit user approval)
For each photo file path provided:
  Call ebay_upload_image to get the hosted image URL.

Generate SKU: "item-[YYYYMMDD]-[random 4 digits]"

Call ebay_create_inventory_item with:
  - sku, title, description, condition, conditionDescription
  - imageUrls (all from ebay_upload_image)
  - itemSpecifics (Brand, Model, and any other specifics from Step 5)

Call ebay_create_offer with:
  - sku, categoryId, price, currency (USD), quantity (1)
  - listingDescription (same HTML as description above)

Call ebay_publish_offer with the offerId from the previous step.

STEP 8 — CONFIRM
Show the user the live listing URL. Offer to list another item.
```

---

## Phase 5 — End-to-End Test

### Sandbox Run
1. Set `EBAY_ENVIRONMENT=sandbox` in `.env` and in `claude_desktop_config.json`.
2. Use sandbox credentials from the developer portal.
3. Trigger the skill with a real test photo file path.
4. Verify all 7 tool calls appear in Claude's tool trace with correct inputs.
5. Confirm the listing appears in the eBay Sandbox Seller Hub.
6. Check the listing record: condition code accepted, item specifics present, images hosted.

### Switch to Production
1. Set `EBAY_ENVIRONMENT=production` and use production credentials.
2. Restart Claude Desktop.
3. List one low-value real item end to end.
4. Confirm live listing URL is returned at Step 8 and listing is visible on eBay.

---

## Appendix A — API Reference

| Tool | API | Endpoint |
|---|---|---|
| `ebay_get_category_suggestions` | Taxonomy | `GET /commerce/taxonomy/v1/category_tree/0/get_category_suggestions` |
| `ebay_search_by_image` | Browse | `POST /buy/browse/v1/item_summary/search_by_image` |
| `google_vision_web_detection` | Google Vision | `POST https://vision.googleapis.com/v1/images:annotate` |
| `ebay_upload_image` | Media | `POST /sell/media/v1/image` |
| `ebay_create_inventory_item` | Inventory | `PUT /sell/inventory/v1/inventory_item/{sku}` |
| `ebay_create_offer` | Inventory | `POST /sell/inventory/v1/offer` |
| `ebay_publish_offer` | Inventory | `POST /sell/inventory/v1/offer/{offerId}/publish` |

All eBay endpoints use base `https://api.ebay.com` (production) or `https://api.sandbox.ebay.com` (sandbox), controlled by `EBAY_ENVIRONMENT`.

---

## Appendix B — eBay Inventory API Condition Codes

| Label | Code | Use When |
|---|---|---|
| New | `NEW` | Unused, original packaging |
| Like New | `LIKE_NEW` | Open box or barely used, no defects |
| Very Good | `VERY_GOOD` | Light use, minor cosmetic issues |
| Good | `GOOD` | Normal use, visible wear |
| Acceptable | `ACCEPTABLE` | Heavy use, fully functional |
| For Parts | `FOR_PARTS_OR_NOT_WORKING` | Not fully functional |

---

## Appendix C — Future Enhancements

- **Etsy cross-posting:** After eBay approval, draft a parallel listing using same research. Requires Etsy OAuth and v3 API.
- **Listing management skill:** Second skill to check status, update price, or end listings.
- **Draft storage:** Log generated listings to a local SQLite database for records and relisting.
- **Mobile support:** Deploy MCP server to Railway or Render to enable use from the Claude mobile app (requires HTTPS endpoint instead of stdio transport).
