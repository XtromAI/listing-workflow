import axios, { AxiosError } from "axios";
import { getAccessToken, getEbayBaseUrl } from "../auth/oauth.js";

// Maps eBay conditionId integers to Inventory API condition enums
const CONDITION_ID_TO_ENUM: Record<string, string> = {
  "1000": "NEW",
  "1500": "NEW_OTHER",
  "1750": "NEW_WITH_DEFECTS",
  "2000": "LIKE_NEW",
  "2010": "EXCELLENT_REFURBISHED",
  "2020": "VERY_GOOD_REFURBISHED",
  "2030": "GOOD_REFURBISHED",
  "2500": "SELLER_REFURBISHED",
  "3000": "USED_EXCELLENT",
  "4000": "USED_VERY_GOOD",
  "5000": "USED_GOOD",
  "6000": "USED_ACCEPTABLE",
  "7000": "FOR_PARTS_OR_NOT_WORKING",
};

export const definition = {
  name: "ebay_get_category_requirements",
  description:
    "Get required item specifics and valid condition values for an eBay category. Call this right after ebay_get_category_suggestions, before creating the inventory item.",
  inputSchema: {
    type: "object" as const,
    properties: {
      categoryId: { type: "string", description: "eBay category ID" },
    },
    required: ["categoryId"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const categoryId = args.categoryId as string;
  const token = await getAccessToken();
  const base = getEbayBaseUrl();

  const [aspectsRes, conditionsRes] = await Promise.all([
    axios
      .get(
        `${base}/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category`,
        { params: { category_id: categoryId }, headers: { Authorization: `Bearer ${token}` } }
      )
      .catch((err: AxiosError) => {
        throw new Error(`Aspects API error: ${JSON.stringify(err.response?.data ?? err.message)}`);
      }),
    axios
      .get(
        `${base}/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies`,
        { params: { filter: `categoryId:{${categoryId}}` }, headers: { Authorization: `Bearer ${token}` } }
      )
      .catch((err: AxiosError) => {
        throw new Error(`Conditions API error: ${JSON.stringify(err.response?.data ?? err.message)}`);
      }),
  ]);

  const aspects = (aspectsRes.data.aspects ?? []) as Array<{
    localizedAspectName: string;
    aspectConstraint: { aspectRequired: boolean };
    aspectValues?: Array<{ localizedValue: string }>;
  }>;

  const requiredAspects = aspects
    .filter((a) => a.aspectConstraint?.aspectRequired)
    .map((a) => ({
      name: a.localizedAspectName,
      suggestedValues: a.aspectValues?.map((v) => v.localizedValue) ?? [],
    }));

  const policy = conditionsRes.data.itemConditionPolicies?.[0];
  const validConditions = (policy?.itemConditions ?? []).map(
    (c: { conditionId: string; conditionDescription: string }) => ({
      conditionDescription: c.conditionDescription,
      inventoryApiCondition: CONDITION_ID_TO_ENUM[c.conditionId] ?? null,
    })
  );

  return {
    categoryId,
    requiredAspects,
    validConditions,
    conditionRequired: policy?.itemConditionRequired ?? false,
  };
}
