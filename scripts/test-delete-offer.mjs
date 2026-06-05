// Live API test for ebay_delete_offer.
// Creates an inventory item, creates an offer against it, deletes the offer,
// then confirms the offer is gone. Cleans up the inventory item at the end.
// Usage: node scripts/test-delete-offer.mjs
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

const {
  EBAY_CLIENT_ID,
  EBAY_CLIENT_SECRET,
  EBAY_REFRESH_TOKEN,
  EBAY_ENVIRONMENT,
  EBAY_FULFILLMENT_POLICY_ID,
  EBAY_PAYMENT_POLICY_ID,
  EBAY_RETURN_POLICY_ID,
  EBAY_MERCHANT_LOCATION_KEY,
} = process.env;

const missing = [
  "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_REFRESH_TOKEN",
  "EBAY_FULFILLMENT_POLICY_ID", "EBAY_PAYMENT_POLICY_ID",
  "EBAY_RETURN_POLICY_ID", "EBAY_MERCHANT_LOCATION_KEY",
].filter((k) => !process.env[k]);

if (missing.length) {
  console.error(`ERROR: missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const BASE_URL =
  EBAY_ENVIRONMENT === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

const TEST_SKU = "TEST-DELETE-OFFER-001";

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

async function upsertInventoryItem(token, sku) {
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
      body: JSON.stringify({
        product: {
          title: "[TEST] Delete Offer Integration Test",
          description: "<p>Automated test item — safe to delete</p>",
          aspects: {},
        },
        condition: "USED_GOOD",
        availability: { shipToLocationAvailability: { quantity: 1 } },
      }),
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error("Inventory item upsert failed"), { response: { status: res.status, data } });
  }
}

async function createOffer(token, sku) {
  const res = await fetch(`${BASE_URL}/sell/inventory/v1/offer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      "Accept-Language": "en-US",
    },
    body: JSON.stringify({
      sku,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      listingDescription: "<p>Automated test offer — safe to delete</p>",
      pricingSummary: { price: { value: "9.99", currency: "USD" } },
      availableQuantity: 1,
      categoryId: "139971", // Collectibles > Trading Cards
      merchantLocationKey: EBAY_MERCHANT_LOCATION_KEY,
      listingPolicies: {
        fulfillmentPolicyId: EBAY_FULFILLMENT_POLICY_ID,
        paymentPolicyId: EBAY_PAYMENT_POLICY_ID,
        returnPolicyId: EBAY_RETURN_POLICY_ID,
      },
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error("Create offer failed"), { response: { status: res.status, data } });
  }
  return (await res.json()).offerId;
}

async function getOffer(token, offerId) {
  const res = await fetch(
    `${BASE_URL}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
    { headers: { Authorization: `Bearer ${token}`, "Accept-Language": "en-US" } }
  );
  return res;
}

async function deleteOffer(token, offerId) {
  const res = await fetch(
    `${BASE_URL}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "Accept-Language": "en-US" } }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error("Delete offer failed"), { response: { status: res.status, data } });
  }
}

async function deleteInventoryItem(token, sku) {
  const res = await fetch(
    `${BASE_URL}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "Accept-Language": "en-US" } }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error("Delete inventory item failed"), { response: { status: res.status, data } });
  }
}

console.log(`\nDelete Offer — live eBay API test (${EBAY_ENVIRONMENT ?? "production"})\n`);

let token;
try {
  token = await getToken();
  ok("OAuth token obtained");
} catch (err) {
  fail("OAuth token fetch", err);
  process.exit(1);
}

// Step 1: create inventory item (required before an offer can be created)
try {
  await upsertInventoryItem(token, TEST_SKU);
  ok(`Inventory item created (SKU: ${TEST_SKU})`);
} catch (err) {
  fail("Create inventory item", err);
  process.exit(1);
}

// Step 2: create offer
let offerId;
try {
  offerId = await createOffer(token, TEST_SKU);
  ok(`Offer created (offerId: ${offerId})`);
} catch (err) {
  fail("Create offer", err);
  // Clean up inventory item before exiting
  await deleteInventoryItem(token, TEST_SKU).catch(() => {});
  process.exit(1);
}

// Step 3: confirm offer exists
try {
  const res = await getOffer(token, offerId);
  if (res.ok) {
    ok("GET offer returns 200 (offer exists before delete)");
  } else {
    fail("GET offer before delete", new Error(`Expected 200, got ${res.status}`));
  }
} catch (err) {
  fail("GET offer before delete", err);
}

// Step 4: delete the offer
try {
  await deleteOffer(token, offerId);
  ok(`Offer deleted (offerId: ${offerId})`);
} catch (err) {
  fail("Delete offer", err);
}

// Step 5: confirm offer is gone
try {
  const res = await getOffer(token, offerId);
  if (res.status === 404) {
    ok("GET offer returns 404 after delete (offer is gone)");
  } else {
    fail("GET offer after delete", new Error(`Expected 404, got ${res.status}`));
  }
} catch (err) {
  fail("GET offer after delete", err);
}

// Cleanup: delete inventory item
console.log("\n  Cleaning up...");
try {
  await deleteInventoryItem(token, TEST_SKU);
  ok(`Inventory item deleted (SKU: ${TEST_SKU})`);
} catch (err) {
  fail(`Delete inventory item (SKU: ${TEST_SKU})`, err);
}

console.log(`\n${failed === 0 ? "PASSED" : "FAILED"} (${passed} passed, ${failed} failed)\n`);
if (failed > 0) process.exit(1);
