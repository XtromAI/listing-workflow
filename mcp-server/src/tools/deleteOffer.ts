import axios, { AxiosError } from "axios";
import { getAccessToken, getEbayBaseUrl } from "../auth/oauth.js";

export const definition = {
  name: "ebay_delete_offer",
  description: "Delete an eBay offer by offer ID. The offer must not be in a published/active state.",
  inputSchema: {
    type: "object" as const,
    properties: {
      offerId: { type: "string", description: "The offer ID to delete" },
    },
    required: ["offerId"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const offerId = args.offerId as string;
  const token = await getAccessToken();

  try {
    await axios.delete(
      `${getEbayBaseUrl()}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response) {
      throw new Error(
        `eBay Delete Offer API ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`
      );
    }
    throw err;
  }

  return { deleted: true, offerId };
}
