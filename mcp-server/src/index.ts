import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types";

import * as getCategories from "./tools/getCategories";
import * as searchByImage from "./tools/searchByImage";
import * as visionDetect from "./tools/visionDetect";
import * as uploadImage from "./tools/uploadImage";
import * as createItem from "./tools/createItem";
import * as createOffer from "./tools/createOffer";
import * as publishOffer from "./tools/publishOffer";

const tools = [
  getCategories,
  searchByImage,
  visionDetect,
  uploadImage,
  createItem,
  createOffer,
  publishOffer,
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
