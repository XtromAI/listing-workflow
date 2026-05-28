# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repository Is

A marketplace listing workflow consisting of:
- **`mcp-server/`** — A locally-hosted Node.js/TypeScript MCP server exposing eBay and Etsy API tools to Claude Desktop
- **`cowork-skill/listing-workflow.md`** — The Claude skill prompt that orchestrates the two-phase listing workflow using those MCP tools
- **`notification-handler/`** — A Google Cloud Function (plain JS) satisfying eBay's GDPR/CCPA account-deletion notification compliance requirement (one-time deploy)

The workflow monitors an `Inbox/` folder for photos, researches and drafts listings (Phase 1 → saves to `drafts/`), then posts to eBay and/or Etsy on approval (Phase 2 → moves to `listings/`).

## MCP Server Commands

All commands run from `mcp-server/`:

```bash
npm run build        # tsc compile → build/
npm run dev          # ts-node src/index.ts (local dev, loads .env)
npm test             # vitest run (single run)
npm run test:watch   # vitest watch mode
npm run test:coverage
```

Run a single test file:
```bash
npx vitest run src/__tests__/tools/createOffer.test.ts
```

After building, register `build/index.js` in the Claude Desktop config under `mcpServers`. Restart Claude Desktop after any config or build change.

**Config location (Windows Store install):**
`%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`

## MCP Server Architecture

Every tool is a TypeScript module in `src/tools/` (Etsy tools are under `src/tools/etsy/`) that exports exactly two things:

```ts
export const definition = { name, description, inputSchema };
export async function handler(args: Record<string, unknown>) { ... }
```

`src/index.ts` imports every tool module into a flat array and registers them all in one loop — no manual dispatch switch. Adding a new tool means creating the module and adding one import + one array entry.

**eBay auth** (`src/auth/oauth.ts`): module-level token cache, refreshed using `EBAY_REFRESH_TOKEN`. Controlled by `EBAY_ENVIRONMENT` (`production` | `sandbox`) which switches the base URL.

**Etsy auth** (`src/auth/etsy-oauth.ts`): same in-memory cache pattern, but Etsy **rotates the refresh token on every use**. The server logs the new token to stderr on each rotation. You must manually update `ETSY_REFRESH_TOKEN` in both `mcp-server/.env` and the Claude Desktop config after any restart, or re-run the OAuth flow if the token has expired.

## Image Handling Differences by Platform

**eBay:** Upload images first (`ebay_upload_image` → hosted URL), then pass URLs when creating the inventory item.

**Etsy:** Create the listing first (`etsy_create_draft_listing` → `listingId`), then attach images using that `listingId`.

All image tools accept a local `imagePath` (absolute path to JPEG/PNG). The MCP server reads and base64-encodes the file; no base64 is passed through the skill prompt.

## Environment Variables

Copy `mcp-server/.env.example` to `mcp-server/.env` and fill in values. Variables must also be set in the Claude Desktop config `env` block — `dotenv` does not load when Claude Desktop spawns the process from its own working directory.

Key groupings:
- eBay: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_REFRESH_TOKEN`, `EBAY_RUNAME`, `EBAY_ENVIRONMENT`, `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`
- eBay local pickup: `EBAY_LOCAL_PICKUP_FULFILLMENT_POLICY_ID`, `EBAY_LOCAL_PICKUP_PAYMENT_POLICY_ID` — set these to the policy IDs of the local pickup fulfillment policy and the pay-in-person payment policy created in eBay Seller Hub. When `localPickup: true` is passed to `ebay_create_offer`, these are used instead of the standard shipping policies.
- Google: `GOOGLE_VISION_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`
- Etsy: `ETSY_API_KEY`, `ETSY_CLIENT_ID` (same value as `ETSY_API_KEY`), `ETSY_REFRESH_TOKEN`, `ETSY_SHOP_ID`, `ETSY_SHIPPING_PROFILE_ID`, `ETSY_RETURN_POLICY_ID`

- eBay: `EBAY_MERCHANT_LOCATION_KEY` — set to `"default-location"` (or whatever key was used when running `ebay_create_merchant_location`). Must be present in both `.env` and the Claude Desktop config `env` block.

## Testing Approach

Tests use **vitest** and mock both `axios` and the auth modules:

```ts
vi.mock("axios");
vi.mock("../../auth/oauth.js", () => ({
  getAccessToken: vi.fn().mockResolvedValue("mock-token"),
  getEbayBaseUrl: vi.fn().mockReturnValue("https://api.ebay.com"),
}));
```

There is no Etsy sandbox — all Etsy API calls hit production. To test Etsy tools manually, create a draft listing and delete it from Etsy Shop Manager afterward.

## eBay-Specific Notes

- eBay's Browse API (`ebay_search_by_image`) requires production eligibility approval — it is not self-service. The tool returns a graceful error if access is denied, and the skill continues using Vision + Gemini instead.
- Condition codes in `ebay_create_inventory_item` use Inventory API format (e.g. `USED_EXCELLENT`, `USED_GOOD`) — these differ from the legacy Trading API codes. The valid conditions for a specific category are returned by `ebay_get_category_requirements`.
- Business policy IDs (`fulfillmentPolicyId`, `paymentPolicyId`, `returnPolicyId`) are read from env vars in `createOffer.ts`, not passed as tool arguments.

## Notification Handler

`notification-handler/` is a standalone Google Cloud Functions gen2 deployment (plain JS, no TypeScript build). It responds to eBay's account-deletion challenge (SHA-256 hash of `challengeCode + verificationToken + endpointUrl`). It has its own `package.json` with `deploy` and `deploy:first` scripts. Its env vars (`EBAY_VERIFICATION_TOKEN`, `NOTIFICATION_ENDPOINT_URL`) are set via `gcloud --set-env-vars`, not in any `.env` file.
