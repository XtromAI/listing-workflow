// Live API test for the local pickup fulfillment/payment policy feature.
// Creates one inventory item, then creates two offers (one standard, one local pickup)
// and verifies the correct policy IDs appear on each offer. Deletes both offers and the item.
// Usage: node scripts/test-local-pickup.mjs
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
  EBAY_LOCAL_PICKUP_FULFILLMENT_POLICY_ID,
  EBAY_LOCAL_PICKUP_PAYMENT_POLICY_ID,
  EBAY_MERCHANT_LOCATION_KEY,
} = process.env;

const missing = [
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "EBAY_REFRESH_TOKEN",
  "EBAY_FULFILLMENT_POLICY_ID",
  "EBAY_PAYMENT_POLICY_ID",
  "EBAY_RETURN_POLICY_ID",
  "EBAY_LOCAL_PICKUP_FULFILLMENT_POLICY_ID",
  "EBAY_LOCAL_PICKUP_PAYMENT_POLICY_ID",
  "EBAY_MERCHANT_LOCATION_KEY",
].filter((k) => !process.env[k]);

if (missing.length) {
  console.error(`ERROR: missing required env vars: ${missing.join(", ")}`);
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

async function upsertItem(token, sku) {
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
          title: "[TEST] Local Pickup Policy Test Item",
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
    throw Object.assign(new Error("Upsert failed"), { response: { status: res.status, data } });
  }
}

async function createOffer(token, sku, localPickup) {
  const fulfillmentPolicyId = localPickup
    ? EBAY_LOCAL_PICKUP_FULFILLMENT_POLICY_ID
    : EBAY_FULFILLMENT_POLICY_ID;
  const paymentPolicyId = localPickup
    ? EBAY_LOCAL_PICKUP_PAYMENT_POLICY_ID
    : EBAY_PAYMENT_POLICY_ID;

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
      listingDescription: "<p>Automated test — safe to delete</p>",
      pricingSummary: { price: { value: "9.99", currency: "USD" } },
      availableQuantity: 1,
      categoryId: "139971", // Collectibles > Rocks, Fossils & Minerals (leaf category, low friction)
      merchantLocationKey: EBAY_MERCHANT_LOCATION_KEY,
      listingPolicies: {
        fulfillmentPolicyId,
        paymentPolicyId,
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
  const res = await fetch(`${BASE_URL}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Accept-Language": "en-US" },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error("Get offer failed"), { response: { status: res.status, data } });
  }
  return res.json();
}

async function deleteOffer(token, offerId) {
  const res = await fetch(`${BASE_URL}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "Accept-Language": "en-US" },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error("Delete offer failed"), { response: { status: res.status, data } });
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

const SKU = "TEST-LOCAL-PICKUP-001";
const offerIds = { standard: null, localPickup: null };

console.log(`\nLocal Pickup Policies — live eBay API test (${EBAY_ENVIRONMENT ?? "production"})\n`);

let token;
try {
  token = await getToken();
  ok("OAuth token obtained");
} catch (err) {
  fail("OAuth token fetch", err);
  process.exit(1);
}

// --- create shared inventory item ---
try {
  await upsertItem(token, SKU);
  ok(`Inventory item created (SKU: ${SKU})`);
} catch (err) {
  fail(`Create inventory item (SKU: ${SKU})`, err);
  process.exit(1);
}

// --- standard shipping offer ---
try {
  offerIds.standard = await createOffer(token, SKU, false);
  ok(`Standard offer created (offerId: ${offerIds.standard})`);
} catch (err) {
  fail("Create standard offer", err);
}

if (offerIds.standard) {
  try {
    const offer = await getOffer(token, offerIds.standard);
    const policies = offer.listingPolicies ?? {};
    if (policies.fulfillmentPolicyId === EBAY_FULFILLMENT_POLICY_ID) {
      ok(`Standard fulfillment policy ID correct (${EBAY_FULFILLMENT_POLICY_ID})`);
    } else {
      fail(
        "Standard fulfillment policy ID mismatch",
        new Error(`expected ${EBAY_FULFILLMENT_POLICY_ID}, got ${policies.fulfillmentPolicyId}`)
      );
    }
    if (policies.paymentPolicyId === EBAY_PAYMENT_POLICY_ID) {
      ok(`Standard payment policy ID correct (${EBAY_PAYMENT_POLICY_ID})`);
    } else {
      fail(
        "Standard payment policy ID mismatch",
        new Error(`expected ${EBAY_PAYMENT_POLICY_ID}, got ${policies.paymentPolicyId}`)
      );
    }
  } catch (err) {
    fail("GET standard offer policies", err);
  }
}

// eBay allows only one offer per SKU — delete the standard offer before creating the local pickup one
if (offerIds.standard) {
  try {
    await deleteOffer(token, offerIds.standard);
    ok(`Standard offer deleted before local pickup test (${offerIds.standard})`);
    offerIds.standard = null;
  } catch (err) {
    fail(`Delete standard offer before local pickup test`, err);
  }
}

// --- local pickup offer ---
try {
  offerIds.localPickup = await createOffer(token, SKU, true);
  ok(`Local pickup offer created (offerId: ${offerIds.localPickup})`);
} catch (err) {
  fail("Create local pickup offer", err);
}

if (offerIds.localPickup) {
  try {
    const offer = await getOffer(token, offerIds.localPickup);
    const policies = offer.listingPolicies ?? {};
    if (policies.fulfillmentPolicyId === EBAY_LOCAL_PICKUP_FULFILLMENT_POLICY_ID) {
      ok(`Local pickup fulfillment policy ID correct (${EBAY_LOCAL_PICKUP_FULFILLMENT_POLICY_ID})`);
    } else {
      fail(
        "Local pickup fulfillment policy ID mismatch",
        new Error(
          `expected ${EBAY_LOCAL_PICKUP_FULFILLMENT_POLICY_ID}, got ${policies.fulfillmentPolicyId}`
        )
      );
    }
    if (policies.paymentPolicyId === EBAY_LOCAL_PICKUP_PAYMENT_POLICY_ID) {
      ok(`Local pickup payment policy ID correct (${EBAY_LOCAL_PICKUP_PAYMENT_POLICY_ID})`);
    } else {
      fail(
        "Local pickup payment policy ID mismatch",
        new Error(
          `expected ${EBAY_LOCAL_PICKUP_PAYMENT_POLICY_ID}, got ${policies.paymentPolicyId}`
        )
      );
    }
  } catch (err) {
    fail("GET local pickup offer policies", err);
  }
}

console.log("\n  Cleaning up...");

for (const [label, offerId] of Object.entries(offerIds)) {
  if (!offerId) continue;
  try {
    await deleteOffer(token, offerId);
    ok(`Deleted ${label} offer (${offerId})`);
  } catch (err) {
    fail(`Delete ${label} offer (${offerId})`, err);
  }
}

try {
  await deleteItem(token, SKU);
  ok(`Deleted inventory item (SKU: ${SKU})`);
} catch (err) {
  fail(`Delete inventory item (SKU: ${SKU})`, err);
}

console.log(`\n${failed === 0 ? "PASSED" : "FAILED"} (${passed} passed, ${failed} failed)\n`);
if (failed > 0) process.exit(1);
