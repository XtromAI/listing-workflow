import axios, { AxiosError } from "axios";
import { getAccessToken, getEbayBaseUrl } from "../auth/oauth.js";

export const definition = {
  name: "ebay_publish_offer",
  description: "Publish an eBay offer to make it a live listing",
  inputSchema: {
    type: "object" as const,
    properties: {
      offerId: { type: "string", description: "The offer ID from ebay_create_offer" },
    },
    required: ["offerId"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const offerId = args.offerId as string;
  const token = await getAccessToken();

  let response;
  try {
    response = await axios.post(
      `${getEbayBaseUrl()}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response) {
      throw new Error(
        `eBay Publish API ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`
      );
    }
    throw err;
  }

  const listingId = response.data.listingId as string;
  return {
    listingId,
    listingUrl: `https://www.ebay.com/itm/${listingId}`,
  };
}
