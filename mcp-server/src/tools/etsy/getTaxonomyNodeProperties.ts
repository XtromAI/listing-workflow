import axios, { AxiosError } from "axios";
import { ETSY_BASE_URL } from "../../auth/etsy-oauth.js";

export const definition = {
  name: "etsy_get_taxonomy_node_properties",
  description:
    "Get the attributes and properties for a specific Etsy taxonomy node. Call after etsy_get_taxonomy_nodes to see what fields are available for the chosen category.",
  inputSchema: {
    type: "object" as const,
    properties: {
      taxonomyId: {
        type: "number",
        description: "Taxonomy node ID from etsy_get_taxonomy_nodes",
      },
    },
    required: ["taxonomyId"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const taxonomyId = args.taxonomyId as number;

  let response;
  try {
    response = await axios.get(
      `${ETSY_BASE_URL}/application/seller-taxonomy/nodes/${taxonomyId}/properties`,
      { headers: { "x-api-key": process.env.ETSY_API_KEY! } }
    );
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response) {
      throw new Error(
        `Etsy Taxonomy API ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`
      );
    }
    throw err;
  }

  const properties = (response.data.results ?? []) as Array<{
    id: number;
    name: string;
    display_name: string;
    scales: Array<{ id: number; display_name: string }>;
    is_required: boolean;
    supports_variations: boolean;
    property_values: Array<{ id: number; name: string; scale_id: number | null }>;
  }>;

  return {
    taxonomyId,
    properties: properties.map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.display_name,
      required: p.is_required,
      supportsVariations: p.supports_variations,
      scales: p.scales.map((s) => ({ id: s.id, name: s.display_name })),
      possibleValues: p.property_values.map((v) => ({ id: v.id, name: v.name })),
    })),
  };
}
