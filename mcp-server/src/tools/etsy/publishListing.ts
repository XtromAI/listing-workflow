import axios, { AxiosError } from "axios";
import { getEtsyAccessToken, ETSY_BASE_URL } from "../../auth/etsy-oauth.js";

export const definition = {
  name: "etsy_publish_listing",
  description:
    "Publish a draft Etsy listing to make it active and publicly visible. Call after uploading all images with etsy_upload_listing_image.",
  inputSchema: {
    type: "object" as const,
    properties: {
      listingId: { type: "number", description: "Listing ID from etsy_create_draft_listing" },
    },
    required: ["listingId"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const listingId = args.listingId as number;
  const token = await getEtsyAccessToken();
  const shopId = process.env.ETSY_SHOP_ID!;

  let response;
  try {
    response = await axios.patch(
      `${ETSY_BASE_URL}/application/shops/${shopId}/listings/${listingId}`,
      { state: "active" },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-api-key": process.env.ETSY_API_KEY!,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response) {
      throw new Error(
        `Etsy Listings API ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`
      );
    }
    throw err;
  }

  return {
    listingId: response.data.listing_id as number,
    listingUrl: response.data.url as string,
  };
}
