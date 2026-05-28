// Live API test for the shipping dimensions feature.
// Creates two inventory items (one with full L/W/H, one weight-only), then deletes both.
// Usage: node scripts/test-shipping-dimensions.mjs
// Reads eBay credentials from mcp-server/.env (or the environment).

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const candidate of [join(root, "mcp-server", ".env"), join(root, ".env")]) {
  try {
    const lines = readFileSync(candidate, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
    break;
  } catch {
    // try next candidate
  }
}

const { EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REFRESH_TOKEN, EBAY_ENVIRONMENT } = process.env;

if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET || !EBAY_REFRESH_TOKEN) {
  console.error("ERROR: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, and EBAY_REFRESH_TOKEN must be set");
  process.exit(1);
}

const BASE_URL =
  EBAY_ENVIRONMENT === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

let passed = 0;
let failed = 0;

function ok(msg) {
  console.log(`  ✓ ${msg}`);
  passed++;
}

function fail(msg, err) {
  const detail = err?.response
    ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data ?? "")}`
    : (err?.message ?? String(err));
  console.error(`  ✗ ${msg}`);
  console.error(`    ${detail}`);
  failed++;
}

async function getToken() {
  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE_URL}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(EBAY_REFRESH_TOKEN)}`,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error("Token fetch failed"), { response: { status: res.status, data } });
  }
  return (await res.json()).access_token;
}

async function upsertItem(token, sku, withDimensions) {
  const body = {
    product: {
      title: "[TEST] Shipping Dimensions Test Item",
      description: "<p>Automated test item — safe to delete</p>",
      aspects: {},
    },
    condition: "USED_GOOD",
    packageWeightAndSize: {
      weight: { value: 1.5, unit: "POUND" },
      ...(withDimensions
        ? {
            dimensions: {
              length: 12,
              width: 8,
              height: 6,
              unit: "INCH",
            },
          }
        : {}),
    },
    availability: { shipToLocationAvailability: { quantity: 1 } },
  };

  const res = await fetch(
    `${BASE_URL}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        "Accept-Language": "en-US",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error("Upsert failed"), { response: { status: res.status, data } });
  }
}

async function deleteItem(token, sku) {
  const res = await fetch(
    `${BASE_URL}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "Accept-Language": "en-US" } }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error("Delete failed"), { response: { status: res.status, data } });
  }
}

const SKU_WITH_DIMS = "TEST-DIMS-001";
const SKU_WEIGHT_ONLY = "TEST-DIMS-002";

console.log(`\nShipping Dimensions — live eBay API test (${EBAY_ENVIRONMENT ?? "production"})\n`);

let token;
try {
  token = await getToken();
  ok("OAuth token obtained");
} catch (err) {
  fail("OAuth token fetch", err);
  process.exit(1);
}

try {
  await upsertItem(token, SKU_WITH_DIMS, true);
  ok(`Created item with L/W/H dimensions (SKU: ${SKU_WITH_DIMS})`);
} catch (err) {
  fail(`Create item with dimensions (SKU: ${SKU_WITH_DIMS})`, err);
}

try {
  await upsertItem(token, SKU_WEIGHT_ONLY, false);
  ok(`Created weight-only item, no dimensions (SKU: ${SKU_WEIGHT_ONLY})`);
} catch (err) {
  fail(`Create weight-only item (SKU: ${SKU_WEIGHT_ONLY})`, err);
}

console.log("\n  Cleaning up...");

for (const sku of [SKU_WITH_DIMS, SKU_WEIGHT_ONLY]) {
  try {
    await deleteItem(token, sku);
    ok(`Deleted ${sku}`);
  } catch (err) {
    fail(`Delete ${sku}`, err);
  }
}

console.log(`\n${failed === 0 ? "PASSED" : "FAILED"} (${passed} passed, ${failed} failed)\n`);
if (failed > 0) process.exit(1);
