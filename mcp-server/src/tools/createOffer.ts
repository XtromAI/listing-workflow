import axios, { AxiosError } from "axios";
import { getAccessToken, getEbayBaseUrl } from "../auth/oauth.js";

export const definition = {
  name: "ebay_create_offer",
  description: "Create a fixed-price eBay offer for an inventory item (does not publish — call ebay_publish_offer next)",
  inputSchema: {
    type: "object" as const,
    properties: {
      sku: { type: "string", description: "Must match the SKU used in ebay_create_inventory_item" },
      categoryId: { type: "string", description: "Category ID from ebay_get_category_suggestions" },
      price: { type: "number", description: "Listing price" },
      currency: { type: "string", description: "Currency code (e.g. USD)" },
      quantity: { type: "number", description: "Quantity available (default 1)" },
      listingDescription: { type: "string", description: "HTML listing description" },
      localPickup: {
        type: "boolean",
        description: "When true, applies the local pickup fulfillment and payment policies (EBAY_LOCAL_PICKUP_FULFILLMENT_POLICY_ID / EBAY_LOCAL_PICKUP_PAYMENT_POLICY_ID) instead of the standard shipping policies",
      },
    },
    required: ["sku", "categoryId", "price", "currency", "listingDescription"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const { sku, categoryId, price, currency, quantity, listingDescription, localPickup } = args as {
    sku: string;
    categoryId: string;
    price: number;
    currency: string;
    quantity?: number;
    listingDescription: string;
    localPickup?: boolean;
  };

  const token = await getAccessToken();
  const {
    EBAY_FULFILLMENT_POLICY_ID,
    EBAY_PAYMENT_POLICY_ID,
    EBAY_RETURN_POLICY_ID,
    EBAY_MERCHANT_LOCATION_KEY,
    EBAY_LOCAL_PICKUP_FULFILLMENT_POLICY_ID,
    EBAY_LOCAL_PICKUP_PAYMENT_POLICY_ID,
  } = process.env;

  const fulfillmentPolicyId = localPickup
    ? EBAY_LOCAL_PICKUP_FULFILLMENT_POLICY_ID
    : EBAY_FULFILLMENT_POLICY_ID;
  const paymentPolicyId = localPickup
    ? EBAY_LOCAL_PICKUP_PAYMENT_POLICY_ID
    : EBAY_PAYMENT_POLICY_ID;

  let response;
  try {
    response = await axios.post(
      `${getEbayBaseUrl()}/sell/inventory/v1/offer`,
      {
        sku,
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        listingDescription,
        pricingSummary: {
          price: { value: price.toString(), currency },
        },
        availableQuantity: quantity ?? 1,
        categoryId,
        merchantLocationKey: EBAY_MERCHANT_LOCATION_KEY,
        listingPolicies: {
          fulfillmentPolicyId,
          paymentPolicyId,
          returnPolicyId: EBAY_RETURN_POLICY_ID,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
      }
    );
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response) {
      throw new Error(
        `eBay Offer API ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`
      );
    }
    throw err;
  }

  return { offerId: response.data.offerId as string };
}
