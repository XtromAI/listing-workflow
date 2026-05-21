# Etsy API Setup — Authentication & Configuration Guide

This guide covers everything needed to authenticate the Etsy MCP tools and start
creating listings programmatically. Follow the steps in order.

---

## Key Differences from eBay Setup

- **No sandbox environment.** Etsy has no test environment — all API calls hit production.
  Create draft listings and delete them manually to test without exposing them publicly.
- **Rotating refresh tokens.** Etsy invalidates each refresh token after it is used. The
  server logs the new token to stderr on every refresh (see [Handling Token Rotation](#5-handling-refresh-token-rotation)).
- **PKCE OAuth flow.** Etsy uses OAuth 2.0 with PKCE (no client secret required). A small
  helper script handles the one-time setup.
- **Images after listing creation.** Unlike eBay (images first → get URL → create item),
  Etsy requires a listing ID before images can be attached.
- **Single app key.** The Etsy App Key ("keystring") acts as both the `x-api-key` header
  value and the `client_id` in OAuth requests. Both env vars get the same value.

---

## Phase 1 — Create an Etsy Developer App

### 1.1 Register as an Etsy Developer

1. Sign in at [https://www.etsy.com/developers](https://www.etsy.com/developers) using your
   Etsy seller account.
2. Click **Create a new app**.
3. Fill in the form:
   - **App name:** `listing-workflow` (or any name)
   - **What will your app do?** Describe it as an internal tool for managing your own listings.
   - **Who will use your app?** Select "Just me".
4. Submit. After review (usually instant for personal apps), your app appears in the
   **Your Apps** list.

### 1.2 Collect Your Credentials

From your app's detail page, copy:

| Value | Where to find it | Maps to env var |
|---|---|---|
| **Keystring** | Listed under your app name | `ETSY_API_KEY` and `ETSY_CLIENT_ID` |

> **Note:** The Keystring serves two roles in the Etsy v3 API — it is sent as the
> `x-api-key` header on every request, and it is also the `client_id` in OAuth token
> requests. Set both `ETSY_API_KEY` and `ETSY_CLIENT_ID` to the same Keystring value.

### 1.3 Set a Redirect URI

1. On your app's page, click **Edit** (or find the callback URL setting).
2. Add a redirect URI. For a local one-time setup, `http://localhost:3003/callback` works
   well — the helper script in Phase 2 starts a temporary server on that port.
3. Save.

---

## Phase 2 — Complete the OAuth Flow (One-Time)

Etsy uses OAuth 2.0 with PKCE. This generates the refresh token that the MCP server uses
for all subsequent calls. Run this once; after that, the server refreshes automatically.

### 2.1 Required Scopes

The Etsy tools need these two scopes:

| Scope | Required for |
|---|---|
| `listings_w` | Creating, updating, and publishing listings |
| `listings_r` | Reading listing data (optional but recommended for verification) |

### 2.2 Run the PKCE Authorization Script

Save the following as a temporary file (e.g. `etsy-auth-setup.mjs`) outside the repo,
then run it with `node etsy-auth-setup.mjs`. Delete it after you have the refresh token.

```javascript
// etsy-auth-setup.mjs
// One-time script to obtain an Etsy refresh token via PKCE OAuth flow.
// Run: node etsy-auth-setup.mjs
// Requires: node >= 18 (uses built-in crypto and http)

import crypto from "crypto";
import http from "http";
import { URLSearchParams } from "url";

const CLIENT_ID = "YOUR_ETSY_KEYSTRING";       // paste your Keystring here
const REDIRECT_URI = "http://localhost:3003/callback";
const SCOPES = "listings_w listings_r";

// --- PKCE helpers ---
function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

const codeVerifier = base64url(crypto.randomBytes(64));
const codeChallenge = base64url(
  crypto.createHash("sha256").update(codeVerifier).digest()
);
const state = crypto.randomBytes(16).toString("hex");

// --- Build authorization URL ---
const authUrl =
  "https://www.etsy.com/oauth/connect?" +
  new URLSearchParams({
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    client_id: CLIENT_ID,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

console.log("\nOpen this URL in your browser:\n");
console.log(authUrl);
console.log("\nWaiting for redirect on http://localhost:3003/callback ...\n");

// --- Temporary local server to catch the redirect ---
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:3003");
  if (url.pathname !== "/callback") { res.end(); return; }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

  if (returnedState !== state) {
    res.end("State mismatch — aborting.");
    server.close();
    return;
  }

  res.end("Authorization successful! You can close this tab.");
  server.close();

  // --- Exchange code for tokens ---
  const tokenRes = await fetch("https://api.etsy.com/v3/public/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    console.error("Token exchange failed:", await tokenRes.text());
    return;
  }

  const tokens = await tokenRes.json();
  console.log("\n=== SUCCESS — save these values in your .env file ===\n");
  console.log(`ETSY_API_KEY=${CLIENT_ID}`);
  console.log(`ETSY_CLIENT_ID=${CLIENT_ID}`);
  console.log(`ETSY_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log("\nAccess token (expires in", tokens.expires_in, "seconds — server manages this automatically):");
  console.log(tokens.access_token);
});

server.listen(3003);
```

**Steps:**
1. Replace `YOUR_ETSY_KEYSTRING` with your actual Keystring.
2. Run `node etsy-auth-setup.mjs`.
3. Open the printed URL in your browser and authorize the app.
4. The script prints your `ETSY_REFRESH_TOKEN` to the terminal.
5. Copy the values into `mcp-server/.env`.
6. Delete `etsy-auth-setup.mjs` — it contains your Keystring in plain text.

---

## Phase 3 — Find Your Shop and Policy IDs

The MCP server needs your shop ID, a shipping profile ID, and a return policy ID. Run
these one-off API calls after completing the OAuth flow. You only need to do this once.

> All commands below use `curl`. On Windows, run them in Git Bash or WSL. Replace
> `YOUR_API_KEY`, `YOUR_ACCESS_TOKEN`, and `YOUR_SHOP_NAME` with real values.

### 3.1 Find Your Shop ID

```bash
curl -s "https://openapi.etsy.com/v3/application/shops?shop_name=YOUR_SHOP_NAME" \
  -H "x-api-key: YOUR_API_KEY" | python3 -m json.tool
```

Look for `shop_id` in the response. This is a numeric value (e.g. `12345678`).

Alternatively, go to your **Etsy Shop Manager**, click any listing, and look at the URL:
`https://www.etsy.com/your/shops/YOUR_SHOP_NAME/tools/listings` — the numeric shop ID
appears in API responses, not the URL itself, so the curl call above is the most reliable
method.

### 3.2 Find Your Shipping Profile ID

```bash
curl -s "https://openapi.etsy.com/v3/application/shops/YOUR_SHOP_ID/shipping-profiles" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" | python3 -m json.tool
```

Each profile in the `results` array has a `shipping_profile_id`. Note the ID of the
profile you want as the default for new listings.

> **Create a profile first if none exist:** Go to
> [Etsy Shop Manager → Settings → Shipping settings](https://www.etsy.com/your/shops/settings/shipping)
> and create at least one shipping profile before running this call.

### 3.3 Find Your Return Policy ID

```bash
curl -s "https://openapi.etsy.com/v3/application/shops/YOUR_SHOP_ID/return-policies" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" | python3 -m json.tool
```

Each policy in the `results` array has a `return_policy_id`. Note the ID of the policy
you want applied to new listings by default.

> **Create a policy first if none exist:** Go to
> [Etsy Shop Manager → Settings → Policies](https://www.etsy.com/your/shops/settings/policies)
> and create a return policy.

---

## Phase 4 — Configure Environment Variables

### 4.1 Create the `.env` File

In `mcp-server/`, copy `.env.example` to `.env` and fill in every value:

```env
# --- eBay credentials (existing) ---
EBAY_CLIENT_ID=your_ebay_client_id
EBAY_CLIENT_SECRET=your_ebay_client_secret
EBAY_REFRESH_TOKEN=your_ebay_refresh_token
EBAY_RUNAME=your_runame
EBAY_ENVIRONMENT=production
EBAY_FULFILLMENT_POLICY_ID=your_policy_id
EBAY_PAYMENT_POLICY_ID=your_policy_id
EBAY_RETURN_POLICY_ID=your_policy_id

# --- Google Vision ---
GOOGLE_VISION_API_KEY=your_google_vision_key

# --- Etsy credentials ---
# ETSY_API_KEY and ETSY_CLIENT_ID are the same value (your app's Keystring)
ETSY_API_KEY=your_etsy_keystring
ETSY_CLIENT_ID=your_etsy_keystring
ETSY_REFRESH_TOKEN=your_etsy_refresh_token   # from Phase 2

# --- Etsy shop configuration ---
ETSY_SHOP_ID=12345678                        # numeric ID from Phase 3.1
ETSY_SHIPPING_PROFILE_ID=98765432            # from Phase 3.2
ETSY_RETURN_POLICY_ID=11223344               # from Phase 3.3
```

`.env` is gitignored. Never commit it.

### 4.2 Claude Desktop Configuration

Add the Etsy env vars to `claude_desktop_config.json`. The existing eBay entry already
starts the MCP server; just add the Etsy keys to its `env` block:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "listing-agent": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\mcp-server\\build\\index.js"],
      "env": {
        "EBAY_CLIENT_ID": "your_ebay_client_id",
        "EBAY_CLIENT_SECRET": "your_ebay_client_secret",
        "EBAY_REFRESH_TOKEN": "your_ebay_refresh_token",
        "EBAY_RUNAME": "your_runame",
        "EBAY_ENVIRONMENT": "production",
        "EBAY_FULFILLMENT_POLICY_ID": "your_policy_id",
        "EBAY_PAYMENT_POLICY_ID": "your_policy_id",
        "EBAY_RETURN_POLICY_ID": "your_policy_id",
        "GOOGLE_VISION_API_KEY": "your_google_vision_key",
        "ETSY_API_KEY": "your_etsy_keystring",
        "ETSY_CLIENT_ID": "your_etsy_keystring",
        "ETSY_REFRESH_TOKEN": "your_etsy_refresh_token",
        "ETSY_SHOP_ID": "12345678",
        "ETSY_SHIPPING_PROFILE_ID": "98765432",
        "ETSY_RETURN_POLICY_ID": "11223344"
      }
    }
  }
}
```

> **Important:** When env vars are set in the Claude Desktop config, `dotenv` is a no-op —
> the server reads from the process environment directly. Set them in one place only
> (either `.env` for local dev or the Claude Desktop config for production).

---

## Phase 5 — Handling Refresh Token Rotation

Etsy invalidates each refresh token immediately after it is used. The server keeps the
new token in memory for the life of the process, but if the server restarts, it falls
back to `ETSY_REFRESH_TOKEN` from the environment — which may be stale if a refresh
happened in a previous session.

**How to detect a stale token:** The server logs a message to stderr each time the token
rotates:

```
[etsy-auth] Refresh token rotated. Update ETSY_REFRESH_TOKEN in your .env to: <new_token>
```

In Claude Desktop, stderr from the MCP server appears in the **Claude Desktop log file**:
- **Windows:** `%APPDATA%\Claude\logs\mcp-server-listing-agent.log`
- **Mac:** `~/Library/Logs/Claude/mcp-server-listing-agent.log`

**Workflow to stay current:**

1. After any session where Etsy tools were used, check the log for the rotation message.
2. Copy the new token and update `ETSY_REFRESH_TOKEN` in both `.env` and the Claude
   Desktop config.
3. Restart Claude Desktop to load the updated config.

**If you get a 401 Unauthorized error** from any Etsy tool, your refresh token is stale.
Re-run the authorization script from Phase 2 to get a fresh refresh token.

> **Tip:** Keep the `etsy-auth-setup.mjs` script (with your Keystring filled in) in a
> secure location outside the repo so you can re-run it quickly when needed.

---

## Phase 6 — Verify the Setup

### 6.1 Build the Server

```bash
cd mcp-server
npm install
npm run build
```

### 6.2 Test Taxonomy Lookup (No Auth Required)

This endpoint only needs the API key — a quick sanity check before testing OAuth:

```bash
curl -s "https://openapi.etsy.com/v3/application/seller-taxonomy/nodes" \
  -H "x-api-key: YOUR_API_KEY" | python3 -m json.tool | head -30
```

You should see a JSON response with a `results` array of taxonomy nodes. If you get a
`403 Forbidden`, your API key is incorrect or the app is not approved.

### 6.3 Test a Draft Listing End-to-End

1. Restart Claude Desktop.
2. Start a new conversation and ask:
   ```
   List the available tools from the listing-agent MCP server.
   ```
   You should see both the eBay tools and the five new Etsy tools (`etsy_get_taxonomy_nodes`,
   `etsy_get_taxonomy_node_properties`, `etsy_create_draft_listing`,
   `etsy_upload_listing_image`, `etsy_publish_listing`).

3. Test the full flow with a low-value item:
   ```
   Create a draft Etsy listing for [item description]. Keep it as a draft — 
   do not publish.
   ```
   Verify the draft appears in your
   [Etsy Shop Manager → Listings → Drafts](https://www.etsy.com/your/shops/listings?state=draft).
   Delete the test draft manually afterwards.

---

## Appendix A — Etsy API Reference

| Tool | Method | Endpoint |
|---|---|---|
| `etsy_get_taxonomy_nodes` | `GET` | `/application/seller-taxonomy/nodes` |
| `etsy_get_taxonomy_node_properties` | `GET` | `/application/seller-taxonomy/nodes/{id}/properties` |
| `etsy_create_draft_listing` | `POST` | `/application/shops/{shop_id}/listings` |
| `etsy_upload_listing_image` | `POST` | `/application/shops/{shop_id}/listings/{listing_id}/images` |
| `etsy_publish_listing` | `PATCH` | `/application/shops/{shop_id}/listings/{listing_id}` |

All endpoints use base URL `https://openapi.etsy.com/v3`.

Taxonomy endpoints require only the `x-api-key` header.
All shop-scoped endpoints require both `x-api-key` and `Authorization: Bearer {token}`.

---

## Appendix B — Etsy Listing Workflow

```
1. etsy_get_taxonomy_nodes         → find the right category (returns taxonomyId)
2. etsy_get_taxonomy_node_properties → see what attributes are available
3. google_vision_web_detection     → identify item from photo (shared tool)
4. etsy_create_draft_listing       → create draft (returns listingId)
5. etsy_upload_listing_image       × N → attach each photo to the listing
6. etsy_publish_listing            → make the listing active
```

Note the order difference from eBay: images are uploaded **after** creating the listing
(Etsy requires a `listing_id` to attach images to), whereas eBay images are uploaded
first to get hosted URLs.

---

## Appendix C — Required `whenMade` Values

Etsy requires every listing to declare when the item was made. Valid values:

| Value | Meaning |
|---|---|
| `made_to_order` | Made after purchase |
| `2020_2024` | Made 2020–2024 |
| `2010_2019` | Made 2010–2019 |
| `2004_2009` | Made 2004–2009 |
| `before_2004` | Made before 2004 (catch-all recent vintage) |
| `2000_2003` | Made 2000–2003 |
| `1990s` | Made in the 1990s |
| `1980s` | Made in the 1980s |
| `1970s` | Made in the 1970s |
| `1960s` | Made in the 1960s |
| `1950s` | Made in the 1950s |
| `1940s` | Made in the 1940s |
| `1930s` | Made in the 1930s |
| `1920s` | Made in the 1920s |
| `before_1920` | Made before 1920 |

---

## Appendix D — Troubleshooting

| Error | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` on listing tools | Stale refresh token | Re-run Phase 2 OAuth script |
| `403 Forbidden` on taxonomy tools | Invalid API key | Check `ETSY_API_KEY` value |
| `400 Bad Request` on create listing | Missing required field | Check `whoMade`, `whenMade`, `taxonomyId` |
| `404 Not Found` on listing tools | Wrong `ETSY_SHOP_ID` | Re-run Phase 3.1 shop ID lookup |
| No Etsy tools listed in Claude | Server not restarted | Restart Claude Desktop after config change |
| Token rotation message in logs | Normal operation | Update `ETSY_REFRESH_TOKEN` in config |
