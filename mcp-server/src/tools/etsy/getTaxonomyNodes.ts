import axios from "axios";
import { ETSY_BASE_URL } from "../../auth/etsy-oauth.js";

interface TaxonomyNode {
  id: number;
  level: number;
  name: string;
  parent_id: number | null;
  children: TaxonomyNode[];
}

function flattenNodes(
  nodes: TaxonomyNode[],
  parentPath = ""
): Array<{ taxonomyId: number; name: string; level: number; fullPath: string }> {
  const results: Array<{ taxonomyId: number; name: string; level: number; fullPath: string }> = [];
  for (const node of nodes) {
    const fullPath = parentPath ? `${parentPath} > ${node.name}` : node.name;
    results.push({ taxonomyId: node.id, name: node.name, level: node.level, fullPath });
    if (node.children?.length) {
      results.push(...flattenNodes(node.children, fullPath));
    }
  }
  return results;
}

export const definition = {
  name: "etsy_get_taxonomy_nodes",
  description:
    "Search Etsy's seller taxonomy for category nodes matching a query. Returns matching nodes with their IDs for use in etsy_create_draft_listing.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Item type or category keyword (e.g. 'jewelry', 'vintage dress')",
      },
      limit: { type: "number", description: "Max results to return (default 10)" },
    },
    required: ["query"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const query = (args.query as string).toLowerCase();
  const limit = (args.limit as number | undefined) ?? 10;

  const response = await axios.get(`${ETSY_BASE_URL}/application/seller-taxonomy/nodes`, {
    headers: { "x-api-key": process.env.ETSY_API_KEY! },
  });

  const allNodes = flattenNodes(response.data.results as TaxonomyNode[]);
  const matches = allNodes.filter(
    (n) =>
      n.name.toLowerCase().includes(query) || n.fullPath.toLowerCase().includes(query)
  );

  return matches.slice(0, limit);
}
