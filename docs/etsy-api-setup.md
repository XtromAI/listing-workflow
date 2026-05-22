# Etsy API Setup — Authentication & Configuration Guide

Work through this document section by section with Claude Code open. Each step is clearly
labelled **You** (browser or manual action required) or **Claude Code** (Claude Code handles
it — just tell it to proceed).

---

## Key Differences from eBay Setup

- **No sandbox environment.** Etsy has no test environment — all API calls hit production.
  Create draft listings and delete them manually to test without exposing them publicly.
- **Rotating refresh tokens.** Etsy invalidates each refresh token after it is used. The
  server logs the new token to stderr on every refresh (see [Phase 5](#phase-5--handling-refresh-token-rotation)).
- **PKCE OAuth flow.** Etsy uses OAuth 2.0 with PKCE (no client secret required). A helper
  script handles the one-time setup.
- **Images after listing creation.** Unlike eBay (images first → get URL → create item),
  Etsy requires a listing ID before images can be attached.
- **Single app key.** The Etsy App Key ("keystring") acts as both the `x-api-key` header
  value and the `client_id` in OAuth requests. Both env vars get the same value.

---

## Phase 1 — Create an Etsy Developer App

> **You** — browser required, Etsy website

1. Sign in at [https://www.etsy.com/developers](https://www.etsy.com/developers) using your
   Etsy seller account.
2. Click **Create a new app**.
3. Fill in the form:
   - **App name:** `listing-workflow`
   - **What will your app do?** Describe it as an internal tool for managing your own listings.
   - **Who will use your app?** Select "Just me".
4. Submit. After review (usually instant for personal apps), your app appears in **Your Apps**.
5. From your app's detail page, copy the **Keystring**. This single value maps to both
   `ETSY_API_KEY` and `ETSY_CLIENT_ID`.
6. Click **Edit** on your app and add `http://localhost:3003/callback` as a redirect URI. Save.

---

## Phase 2 — Complete the OAuth Flow (One-Time)

This generates the refresh token the MCP server uses for all subsequent calls.

### Step 1 — Fill in and run the auth script

> **You** — tell Claude Code your Keystring

Give Claude Code your Keystring and say: *"Fill in the Keystring in `scripts/etsy-auth-setup.mjs`
and run it."*

> **Claude Code** — edits `scripts/etsy-auth-setup.mjs` with your Keystring and runs:
> ```bash
> node scripts/etsy-auth-setup.mjs
> ```
> The script prints an authorization URL and waits.

### Step 2 — Authorize in the browser

> **You** — browser required

Open the URL the script printed. Sign in with your Etsy account if prompted, then click
**Allow Access**. The browser will redirect to `localhost:3003` and show "Authorization
successful!" — you can close the tab.

### Step 3 — Capture the credentials

> **Claude Code** — reads the terminal output and saves the credentials

The script prints your `ETSY_API_KEY`, `ETSY_CLIENT_ID`, and `ETSY_REFRESH_TOKEN` to the
terminal. Claude Code will capture these and fill them into `mcp-server/.env` in Phase 4.

### Required OAuth Scopes (for reference)

| Scope | Required for |
|---|---|
| `listings_w` | Creating, updating, and publishing listings |
| `listings_r` | Reading listing data (recommended for verification) |

---

## Phase 3 — Find Your Shop and Policy IDs

### 3.1 Prerequisite check

> **You** — verify in Etsy Shop Manager

Before Claude Code can look up the IDs, make sure these exist in your Etsy account:

- At least one **shipping profile**: [Shop Manager → Settings → Shipping settings](https://www.etsy.com/your/shops/settings/shipping)
- At least one **return policy**: [Shop Manager → Settings → Policies](https://www.etsy.com/your/shops/settings/policies)

If either is missing, create it now — the API lookups will return empty results otherwise.

### 3.2 Look up the IDs

> **Claude Code** — runs these three API calls using your Keystring and access token

Tell Claude Code: *"Look up my Etsy shop ID, shipping profile ID, and return policy ID."*

It will run:

```bash
# Shop ID
curl -s "https://openapi.etsy.com/v3/application/shops?shop_name=YOUR_SHOP_NAME" \
  -H "x-api-key: YOUR_API_KEY" | python3 -m json.tool

# Shipping profiles
curl -s "https://openapi.etsy.com/v3/application/shops/YOUR_SHOP_ID/shipping-profiles" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" | python3 -m json.tool

# Return policies
curl -s "https://openapi.etsy.com/v3/application/shops/YOUR_SHOP_ID/return-policies" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" | python3 -m json.tool
```

Claude Code will extract `shop_id`, `shipping_profile_id`, and `return_policy_id` from
the responses and carry them into Phase 4.

---

## Phase 4 — Configure Environment Variables

### Why you need env vars in two places

**Short answer: `.env` is for local dev; the Claude Desktop config is for Claude Desktop itself.**

When you run the server from the terminal (`node build/index.js` from inside `mcp-server/`),
`dotenv` finds and loads `mcp-server/.env` because the working directory is `mcp-server/`.

When **Claude Desktop** launches the server, it spawns the Node process from its own working
directory — not `mcp-server/` — so `dotenv` cannot find the `.env` file and the server starts
with no credentials. The env vars must also be set in the `env` block of
`claude_desktop_config.json`.

They hold the same values in two places. When a credential changes (e.g. a rotated Etsy
refresh token), update both.

### 4.1 Create `mcp-server/.env`

> **Claude Code** — creates the file with all values from Phases 1–3

Tell Claude Code: *"Create `mcp-server/.env` with all the credentials."*

The file should look like this (Claude Code fills in the real values):

```env
# --- eBay credentials ---
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
ETSY_API_KEY=your_etsy_keystring
ETSY_CLIENT_ID=your_etsy_keystring
ETSY_REFRESH_TOKEN=your_etsy_refresh_token

# --- Etsy shop configuration ---
ETSY_SHOP_ID=12345678
ETSY_SHIPPING_PROFILE_ID=98765432
ETSY_RETURN_POLICY_ID=11223344
```

### 4.2 Update Claude Desktop Config

> **Claude Code** — edits `claude_desktop_config.json` to add the Etsy env vars

Tell Claude Code: *"Update my Claude Desktop config with the Etsy credentials."*

Claude Desktop config location:
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Claude Code will add all Etsy keys to the existing `env` block. The final `env` block
should contain every key from both platforms:

```json
{
  "mcpServers": {
    "listing-agent": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\mcp-server\\build\\index.js"],
      "env": {
        "EBAY_CLIENT_ID": "...",
        "EBAY_CLIENT_SECRET": "...",
        "EBAY_REFRESH_TOKEN": "...",
        "EBAY_RUNAME": "...",
        "EBAY_ENVIRONMENT": "production",
        "EBAY_FULFILLMENT_POLICY_ID": "...",
        "EBAY_PAYMENT_POLICY_ID": "...",
        "EBAY_RETURN_POLICY_ID": "...",
        "GOOGLE_VISION_API_KEY": "...",
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

### 4.3 Restart Claude Desktop

> **You** — manual action required

Quit and reopen Claude Desktop so it picks up the updated config.

---

## Phase 5 — Handling Refresh Token Rotation

Etsy invalidates each refresh token immediately after it is used. The server keeps the new
token in memory for the life of the process, but loses it on restart and falls back to the
(now stale) `ETSY_REFRESH_TOKEN` in the config.

### Detecting a rotated token

> **Claude Code** — can check the log file on request

The server logs a message to stderr each time the token rotates:

```
[etsy-auth] Refresh token rotated. Update ETSY_REFRESH_TOKEN in your .env to: <new_token>
```

Claude Desktop writes this to its MCP server log:
- **Windows:** `%APPDATA%\Claude\logs\mcp-server-listing-agent.log`
- **Mac:** `~/Library/Logs/Claude/mcp-server-listing-agent.log`

Tell Claude Code: *"Check the Claude Desktop MCP log for a rotated Etsy token."* It will
read the log and extract the new token if one is present.

### Updating the token

> **Claude Code** — updates both config files

Tell Claude Code: *"Update the Etsy refresh token to `<new_token>` in `.env` and the Claude
Desktop config."*

### Restarting after a token update

> **You** — manual action required

Restart Claude Desktop after any config update for the new token to take effect.

### If you get a 401 Unauthorized error

> **You** — re-run the auth script (Phase 2)

Your refresh token has expired or been invalidated. Go back to Phase 2 and re-authorize.
Claude Code can run the script again; you just need to open the browser URL.

---

## Phase 6 — Verify the Setup

### 6.1 Build the server

> **Claude Code**

Tell Claude Code: *"Build the MCP server."*

```bash
cd mcp-server && npm install && npm run build
```

### 6.2 Test the API key

> **Claude Code**

Tell Claude Code: *"Test the Etsy API key with a taxonomy lookup."*

```bash
curl -s "https://openapi.etsy.com/v3/application/seller-taxonomy/nodes" \
  -H "x-api-key: YOUR_API_KEY" | python3 -m json.tool | head -30
```

A `results` array of taxonomy nodes means the key is valid. A `403 Forbidden` means the
key is wrong or the app is not yet approved.

### 6.3 Verify tools load in Claude Desktop

> **You** — in a Claude Desktop conversation

In a new Claude Desktop conversation, ask:
```
List the available tools from the listing-agent MCP server.
```

You should see both the eBay tools and the five Etsy tools: `etsy_get_taxonomy_nodes`,
`etsy_get_taxonomy_node_properties`, `etsy_create_draft_listing`, `etsy_upload_listing_image`,
`etsy_publish_listing`.

### 6.4 Test a draft listing end-to-end

> **You** — in a Claude Desktop conversation, then verify in Etsy Shop Manager

In Claude Desktop, ask:
```
Create a draft Etsy listing for [describe a low-value item]. Keep it as a draft — do not publish.
```

Then verify the draft appears in [Etsy Shop Manager → Listings → Drafts](https://www.etsy.com/your/shops/listings?state=draft).
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
Taxonomy endpoints require only `x-api-key`. All shop-scoped endpoints require both
`x-api-key` and `Authorization: Bearer {token}`.

---

## Appendix B — Etsy Listing Workflow

```
1. etsy_get_taxonomy_nodes           → find the right category (returns taxonomyId)
2. etsy_get_taxonomy_node_properties → see what attributes are available
3. google_vision_web_detection       → identify item from photo (shared tool)
4. etsy_create_draft_listing         → create draft (returns listingId)
5. etsy_upload_listing_image × N     → attach each photo to the listing
6. etsy_publish_listing              → make the listing active
```

Images are uploaded **after** creating the listing (Etsy requires a `listing_id` first),
unlike eBay where images are uploaded first to get hosted URLs.

---

## Appendix C — Required `whenMade` Values

| Value | Meaning |
|---|---|
| `made_to_order` | Made after purchase |
| `2020_2024` | Made 2020–2024 |
| `2010_2019` | Made 2010–2019 |
| `2004_2009` | Made 2004–2009 |
| `before_2004` | Made before 2004 |
| `2000_2003` | Made 2000–2003 |
| `1990s` | 1990s |
| `1980s` | 1980s |
| `1970s` | 1970s |
| `1960s` | 1960s |
| `1950s` | 1950s |
| `1940s` | 1940s |
| `1930s` | 1930s |
| `1920s` | 1920s |
| `before_1920` | Before 1920 |

---

## Appendix D — Troubleshooting

| Error | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` on listing tools | Stale refresh token | Re-run Phase 2 (you open browser; Claude Code runs the script) |
| `403 Forbidden` on taxonomy tools | Invalid API key | Check `ETSY_API_KEY` value |
| `400 Bad Request` on create listing | Missing required field | Check `whoMade`, `whenMade`, `taxonomyId` |
| `404 Not Found` on listing tools | Wrong `ETSY_SHOP_ID` | Ask Claude Code to re-run the shop ID lookup |
| No Etsy tools listed in Claude | Server not restarted | Restart Claude Desktop after config change |
| Token rotation message in logs | Normal operation | Ask Claude Code to read the log and update both config files |
