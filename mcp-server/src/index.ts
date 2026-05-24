import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import * as getCategories from "./tools/getCategories.js";
import * as getCategoryRequirements from "./tools/getCategoryRequirements.js";
import * as searchByImage from "./tools/searchByImage.js";
import * as searchListings from "./tools/searchListings.js";
import * as visionDetect from "./tools/visionDetect.js";
import * as geminiResearch from "./tools/geminiResearch.js";
import * as uploadImage from "./tools/uploadImage.js";
import * as createItem from "./tools/createItem.js";
import * as createMerchantLocation from "./tools/createMerchantLocation.js";
import * as createOffer from "./tools/createOffer.js";
import * as publishOffer from "./tools/publishOffer.js";

import * as etsyGetTaxonomyNodes from "./tools/etsy/getTaxonomyNodes.js";
import * as etsyGetTaxonomyNodeProperties from "./tools/etsy/getTaxonomyNodeProperties.js";
import * as etsyCreateDraftListing from "./tools/etsy/createDraftListing.js";
import * as etsyUploadListingImage from "./tools/etsy/uploadListingImage.js";
import * as etsyPublishListing from "./tools/etsy/publishListing.js";

const tools = [
  // eBay tools
  getCategories,
  getCategoryRequirements,
  searchByImage,
  searchListings,
  visionDetect,
  geminiResearch,
  uploadImage,
  createItem,
  createMerchantLocation,
  createOffer,
  publishOffer,
  // Etsy tools
  etsyGetTaxonomyNodes,
  etsyGetTaxonomyNodeProperties,
  etsyCreateDraftListing,
  etsyUploadListingImage,
  etsyPublishListing,
];

const handlerMap = new Map(tools.map((t) => [t.definition.name, t.handler]));

const server = new Server(
  { name: "ebay-listing-agent", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => t.definition),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const handler = handlerMap.get(req.params.name);
  if (!handler) {
    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${req.params.name}` }],
      isError: true,
    };
  }
  try {
    const result = await handler(
      (req.params.arguments ?? {}) as Record<string, unknown>
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
