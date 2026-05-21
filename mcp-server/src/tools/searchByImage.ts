import fs from "fs";
import axios from "axios";
import { getAccessToken, getEbayBaseUrl } from "../auth/oauth.js";

export const definition = {
  name: "ebay_search_by_image",
  description: "Search eBay listings by image similarity (requires Browse API production access)",
  inputSchema: {
    type: "object" as const,
    properties: {
      imagePath: { type: "string", description: "Absolute path to JPEG or PNG file" },
      limit: { type: "number", description: "Max results (default 10)" },
    },
    required: ["imagePath"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const imagePath = args.imagePath as string;
  const limit = (args.limit as number | undefined) ?? 10;

  const imageData = fs.readFileSync(imagePath).toString("base64");
  const token = await getAccessToken();

  try {
    const response = await axios.post(
      `${getEbayBaseUrl()}/buy/browse/v1/item_summary/search_by_image`,
      { image: imageData },
      {
        params: { limit },
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const items = (response.data.itemSummaries ?? []) as Array<{
      title: string;
      price?: { value: string; currency: string };
      condition?: string;
      itemWebUrl: string;
    }>;

    return items.map((item) => ({
      title: item.title,
      price: item.price ? `${item.price.currency} ${item.price.value}` : null,
      condition: item.condition ?? null,
      itemWebUrl: item.itemWebUrl,
    }));
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      return { error: "Browse API access not yet approved — use web search fallback" };
    }
    throw err;
  }
}
