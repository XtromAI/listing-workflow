import axios from "axios";

function getFindingBaseUrl(): string {
  return process.env.EBAY_ENVIRONMENT === "sandbox"
    ? "https://svcs.sandbox.ebay.com/services/search/FindingService/v1"
    : "https://svcs.ebay.com/services/search/FindingService/v1";
}

export const definition = {
  name: "ebay_search_listings",
  description:
    "Search eBay for sold or active listings to use as pricing comps. Uses the Finding API — no Browse API approval required.",
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

  const operation = soldOnly ? "findCompletedItems" : "findItemsByKeywords";
  const responseRoot = soldOnly ? "findCompletedItemsResponse" : "findItemsByKeywordsResponse";

  const params: Record<string, unknown> = {
    "OPERATION-NAME": operation,
    "SERVICE-VERSION": "1.0.0",
    "SECURITY-APPNAME": process.env.EBAY_CLIENT_ID,
    "RESPONSE-DATA-FORMAT": "JSON",
    keywords,
    "paginationInput.entriesPerPage": limit,
    sortOrder: soldOnly ? "EndTimeSoonest" : "BestMatch",
  };

  if (soldOnly) {
    params["itemFilter(0).name"] = "SoldItemsOnly";
    params["itemFilter(0).value"] = "true";
  }

  const response = await axios.get(getFindingBaseUrl(), { params });

  const resp = response.data[responseRoot]?.[0];
  if (resp?.ack?.[0] !== "Success") {
    throw new Error(`Finding API error: ${JSON.stringify(resp?.errorMessage)}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = resp.searchResult?.[0]?.item ?? [];

  return items.map((item) => {
    const priceEntry = item.sellingStatus?.[0]?.currentPrice?.[0];
    return {
      title: item.title?.[0] ?? null,
      price: priceEntry?.["__value__"] ?? null,
      currency: priceEntry?.["@currencyId"] ?? "USD",
      condition: item.condition?.[0]?.conditionDisplayName?.[0] ?? null,
      endDate: item.listingInfo?.[0]?.endTime?.[0] ?? null,
      itemWebUrl: item.viewItemURL?.[0] ?? null,
    };
  });
}
