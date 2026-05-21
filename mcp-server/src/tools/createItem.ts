import axios from "axios";
import { getAccessToken, getEbayBaseUrl } from "../auth/oauth.js";

export const definition = {
  name: "ebay_create_inventory_item",
  description: "Create or update an eBay inventory item (does not publish — call ebay_create_offer next)",
  inputSchema: {
    type: "object" as const,
    properties: {
      sku: { type: "string", description: "Unique item identifier you generate" },
      title: { type: "string", description: "Item title (80 chars max)" },
      description: { type: "string", description: "Item description (HTML)" },
      condition: {
        type: "string",
        enum: ["NEW", "LIKE_NEW", "VERY_GOOD", "GOOD", "ACCEPTABLE", "FOR_PARTS_OR_NOT_WORKING"],
        description: "Item condition code",
      },
      conditionDescription: {
        type: "string",
        description: "Optional 1-2 sentence condition detail",
      },
      imageUrls: {
        type: "array",
        items: { type: "string" },
        description: "Hosted image URLs from ebay_upload_image",
      },
      itemSpecifics: {
        type: "object",
        description: "Key/value pairs e.g. { Brand: 'Sony', Model: 'WH-1000XM4' }",
      },
    },
    required: ["sku", "title", "description", "condition", "imageUrls"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const {
    sku,
    title,
    description,
    condition,
    conditionDescription,
    imageUrls,
    itemSpecifics,
  } = args as {
    sku: string;
    title: string;
    description: string;
    condition: string;
    conditionDescription?: string;
    imageUrls: string[];
    itemSpecifics?: Record<string, string>;
  };

  const aspects: Record<string, string[]> = {};
  if (itemSpecifics) {
    for (const [key, value] of Object.entries(itemSpecifics)) {
      aspects[key] = [value];
    }
  }

  const token = await getAccessToken();

  await axios.put(
    `${getEbayBaseUrl()}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    {
      product: { title, description, imageUrls, aspects },
      condition,
      ...(conditionDescription ? { conditionDescription } : {}),
      availability: {
        shipToLocationAvailability: { quantity: 1 },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return { success: true };
}
