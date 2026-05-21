import axios from "axios";
import { getAccessToken, getEbayBaseUrl } from "../auth/oauth.js";

export const definition = {
  name: "ebay_get_category_suggestions",
  description: "Get eBay category suggestions for an item based on a title or description",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Item title or description" },
    },
    required: ["query"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const query = args.query as string;
  const token = await getAccessToken();

  const response = await axios.get(
    `${getEbayBaseUrl()}/commerce/taxonomy/v1/category_tree/0/get_category_suggestions`,
    {
      params: { q: query },
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const suggestions = (response.data.categorySuggestions ?? []) as Array<{
    category: { categoryId: string; categoryName: string };
    categoryTreeNodeAncestors?: Array<{ categoryName: string }>;
  }>;

  return suggestions.map((s) => ({
    categoryId: s.category.categoryId,
    categoryName: s.category.categoryName,
    fullPath: s.categoryTreeNodeAncestors
      ? [...s.categoryTreeNodeAncestors]
          .reverse()
          .map((a) => a.categoryName)
          .concat(s.category.categoryName)
          .join(" > ")
      : s.category.categoryName,
  }));
}
