import axios, { AxiosError } from "axios";
import { getAccessToken, getEbayBaseUrl } from "../auth/oauth.js";

export const definition = {
  name: "ebay_search_listings",
  description:
    "Search eBay for sold or active listings to use as pricing comps. soldOnly=true uses the Marketplace Insights API; soldOnly=false uses the Browse API.",
  inputSchema: {
    type: "object" as const,
    properties: {
      keywords: { type: "string", description: "Item keywords to search for" },
      soldOnly: {
        type: "boolean",
        description: "true = completed/sold listings (default), false = active listings",
      },
      limit: { type: "number", description: "Max results (default 5)" },
    },
    required: ["keywords"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const keywords = args.keywords as string;
  const soldOnly = args.soldOnly !== false; // default true when omitted
  const limit = (args.limit as number | undefined) ?? 5;

  const token = await getAccessToken();
  const base = getEbayBaseUrl();
  const headers = { Authorization: `Bearer ${token}` };

  try {
    if (soldOnly) {
      const response = await axios.get(
        `${base}/buy/marketplace_insights/v1_beta/item_sales/search`,
        { params: { q: keywords, limit }, headers }
      );

      const items = (response.data.itemSales ?? []) as Array<{
        title: string;
        lastSoldPrice?: { value: string; currency: string };
        lastSoldDate?: string;
        condition?: string;
        itemWebUrl?: string;
      }>;

      return items.map((item) => ({
        title: item.title,
        price: item.lastSoldPrice?.value ?? null,
        currency: item.lastSoldPrice?.currency ?? "USD",
        condition: item.condition ?? null,
        endDate: item.lastSoldDate ?? null,
        itemWebUrl: item.itemWebUrl ?? null,
      }));
    } else {
      const response = await axios.get(
        `${base}/buy/browse/v1/item_summary/search`,
        { params: { q: keywords, limit }, headers }
      );

      const items = (response.data.itemSummaries ?? []) as Array<{
        title: string;
        price?: { value: string; currency: string };
        condition?: string;
        itemWebUrl: string;
      }>;

      return items.map((item) => ({
        title: item.title,
        price: item.price?.value ?? null,
        currency: item.price?.currency ?? "USD",
        condition: item.condition ?? null,
        endDate: null,
        itemWebUrl: item.itemWebUrl,
      }));
    }
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const axErr = err as AxiosError;
      if (axErr.response?.status === 403) {
        const api = soldOnly ? "Marketplace Insights API" : "Browse API";
        return { error: `${api} access not approved for this app — check developer.ebay.com` };
      }
      throw new Error(
        `eBay API HTTP ${axErr.response?.status ?? "no-response"}: ${JSON.stringify(axErr.response?.data ?? axErr.message)}`
      );
    }
    throw err;
  }
}
