import axios, { AxiosError } from "axios";
import { getEtsyAccessToken, ETSY_BASE_URL } from "../../auth/etsy-oauth.js";

export const definition = {
  name: "etsy_create_draft_listing",
  description:
    "Create a new draft listing in an Etsy shop. Returns a listing ID. Upload images next with etsy_upload_listing_image, then publish with etsy_publish_listing.",
  inputSchema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Listing title (max 140 chars)" },
      description: { type: "string", description: "Listing description" },
      price: { type: "number", description: "Item price in the shop's default currency" },
      quantity: { type: "number", description: "Quantity available (default 1)" },
      taxonomyId: {
        type: "number",
        description: "Taxonomy node ID from etsy_get_taxonomy_nodes",
      },
      whoMade: {
        type: "string",
        enum: ["i_did", "someone_else", "collective"],
        description: "Who made the item",
      },
      whenMade: {
        type: "string",
        enum: [
          "made_to_order",
          "2020_2024",
          "2010_2019",
          "2004_2009",
          "before_2004",
          "2000_2003",
          "1990s",
          "1980s",
          "1970s",
          "1960s",
          "1950s",
          "1940s",
          "1930s",
          "1920s",
          "before_1920",
        ],
        description: "When the item was made",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Up to 13 search tags (each max 20 chars)",
      },
      materials: {
        type: "array",
        items: { type: "string" },
        description: "Materials used to make the item",
      },
      shippingProfileId: {
        type: "number",
        description:
          "Shipping profile ID (falls back to ETSY_SHIPPING_PROFILE_ID env var if omitted)",
      },
      returnPolicyId: {
        type: "number",
        description:
          "Return policy ID (falls back to ETSY_RETURN_POLICY_ID env var if omitted)",
      },
      isSupply: {
        type: "boolean",
        description: "True if the item is a craft supply (default false)",
      },
    },
    required: ["title", "description", "price", "taxonomyId", "whoMade", "whenMade"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const {
    title,
    description,
    price,
    quantity,
    taxonomyId,
    whoMade,
    whenMade,
    tags,
    materials,
    shippingProfileId,
    returnPolicyId,
    isSupply,
  } = args as {
    title: string;
    description: string;
    price: number;
    quantity?: number;
    taxonomyId: number;
    whoMade: string;
    whenMade: string;
    tags?: string[];
    materials?: string[];
    shippingProfileId?: number;
    returnPolicyId?: number;
    isSupply?: boolean;
  };

  const token = await getEtsyAccessToken();
  const shopId = process.env.ETSY_SHOP_ID!;

  const shippingId =
    shippingProfileId ??
    (process.env.ETSY_SHIPPING_PROFILE_ID
      ? parseInt(process.env.ETSY_SHIPPING_PROFILE_ID)
      : undefined);
  const returnId =
    returnPolicyId ??
    (process.env.ETSY_RETURN_POLICY_ID
      ? parseInt(process.env.ETSY_RETURN_POLICY_ID)
      : undefined);

  let response;
  try {
    response = await axios.post(
      `${ETSY_BASE_URL}/application/shops/${shopId}/listings`,
      {
        title,
        description,
        price,
        quantity: quantity ?? 1,
        taxonomy_id: taxonomyId,
        who_made: whoMade,
        when_made: whenMade,
        state: "draft",
        is_supply: isSupply ?? false,
        ...(tags?.length ? { tags } : {}),
        ...(materials?.length ? { materials } : {}),
        ...(shippingId !== undefined ? { shipping_profile_id: shippingId } : {}),
        ...(returnId !== undefined ? { return_policy_id: returnId } : {}),
      },
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

  return { listingId: response.data.listing_id as number };
}
