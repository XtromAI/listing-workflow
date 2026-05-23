import axios, { AxiosError } from "axios";
import { getAccessToken, getEbayBaseUrl } from "../auth/oauth.js";

export const definition = {
  name: "ebay_create_merchant_location",
  description:
    "One-time setup: creates a merchant location in eBay required for publishing offers. " +
    "Run once per account; the key is stored in EBAY_MERCHANT_LOCATION_KEY env var.",
  inputSchema: {
    type: "object" as const,
    properties: {
      merchantLocationKey: {
        type: "string",
        description: 'Unique key for this location (default: "default-location")',
      },
      country: {
        type: "string",
        description: 'ISO 3166-1 alpha-2 country code (default: "US")',
      },
      postalCode: {
        type: "string",
        description: "Postal / ZIP code for the location",
      },
      locationName: {
        type: "string",
        description: 'Human-readable name (default: "Default Location")',
      },
    },
    required: [],
  },
};

export async function handler(args: Record<string, unknown>) {
  const {
    merchantLocationKey = process.env.EBAY_MERCHANT_LOCATION_KEY ?? "default-location",
    country = "US",
    postalCode,
    locationName = "Default Location",
  } = args as {
    merchantLocationKey?: string;
    country?: string;
    postalCode?: string;
    locationName?: string;
  };

  const token = await getAccessToken();

  const body: Record<string, unknown> = {
    location: {
      address: {
        country,
        ...(postalCode ? { postalCode } : {}),
      },
    },
    locationTypes: ["WAREHOUSE"],
    name: locationName,
    merchantLocationStatus: "ENABLED",
  };

  try {
    await axios.post(
      `${getEbayBaseUrl()}/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey as string)}`,
      body,
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
        `eBay Location API ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`
      );
    }
    throw err;
  }

  return {
    merchantLocationKey,
    message: `Location created. Set EBAY_MERCHANT_LOCATION_KEY=${merchantLocationKey} in your .env and Claude Desktop config.`,
  };
}
