import axios, { AxiosError } from "axios";
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
        enum: ["NEW", "LIKE_NEW", "NEW_OTHER", "NEW_WITH_DEFECTS", "USED_EXCELLENT", "USED_VERY_GOOD", "USED_GOOD", "USED_ACCEPTABLE", "FOR_PARTS_OR_NOT_WORKING"],
        description: "Item condition code",
      },
      conditionDescription: {
        type: "string",
        description: "Optional 1-2 sentence condition detail",
      },
      imageUrls: {
        type: "array",
        items: { type: "string" },
        description: "Hosted image URLs from ebay_upload_image (optional — omit to create without images)",
      },
      itemSpecifics: {
        type: "object",
        description: "Key/value pairs e.g. { Brand: 'Sony', Model: 'WH-1000XM4' }",
      },
      weightLbs: {
        type: "number",
        description: "Shipping weight in pounds — required by eBay to publish",
      },
      packageLengthIn: {
        type: "number",
        description: "Packed box length in inches (optional but improves eBay shipping estimate)",
      },
      packageWidthIn: {
        type: "number",
        description: "Packed box width in inches",
      },
      packageHeightIn: {
        type: "number",
        description: "Packed box height in inches",
      },
    },
    required: ["sku", "title", "description", "condition", "weightLbs"],
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
    weightLbs,
    packageLengthIn,
    packageWidthIn,
    packageHeightIn,
  } = args as {
    sku: string;
    title: string;
    description: string;
    condition: string;
    conditionDescription?: string;
    imageUrls: string[];
    itemSpecifics?: Record<string, string>;
    weightLbs: number;
    packageLengthIn?: number;
    packageWidthIn?: number;
    packageHeightIn?: number;
  };

  const aspects: Record<string, string[]> = {};
  if (itemSpecifics) {
    for (const [key, value] of Object.entries(itemSpecifics)) {
      aspects[key] = [value];
    }
  }

  const token = await getAccessToken();

  try {
    await axios.put(
      `${getEbayBaseUrl()}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      {
        product: { title, description, ...(imageUrls?.length ? { imageUrls } : {}), aspects },
        condition,
        ...(conditionDescription ? { conditionDescription } : {}),
        packageWeightAndSize: {
          weight: { value: weightLbs, unit: "POUND" },
          ...(packageLengthIn && packageWidthIn && packageHeightIn
            ? {
                dimensions: {
                  length: packageLengthIn,
                  width: packageWidthIn,
                  height: packageHeightIn,
                  unit: "INCH",
                },
              }
            : {}),
        },
        availability: {
          shipToLocationAvailability: { quantity: 1 },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
        },
      }
    );
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response) {
      throw new Error(
        `eBay Inventory API ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`
      );
    }
    throw err;
  }

  return { success: true };
}
