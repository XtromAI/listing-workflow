import { vi, describe, it, expect, beforeEach } from "vitest";
import axios from "axios";
import { handler, definition } from "../../../tools/etsy/getTaxonomyNodes.js";

vi.mock("axios");

const mockAxios = vi.mocked(axios, true);

const TAXONOMY_TREE = [
  {
    id: 1,
    level: 1,
    name: "Clothing",
    parent_id: null,
    children: [
      {
        id: 10,
        level: 2,
        name: "Dresses",
        parent_id: 1,
        children: [
          {
            id: 100,
            level: 3,
            name: "Vintage Dress",
            parent_id: 10,
            children: [],
          },
        ],
      },
    ],
  },
  {
    id: 2,
    level: 1,
    name: "Jewelry",
    parent_id: null,
    children: [
      {
        id: 20,
        level: 2,
        name: "Necklaces",
        parent_id: 2,
        children: [],
      },
    ],
  },
];

describe("etsy_get_taxonomy_nodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ETSY_API_KEY = "test-etsy-api-key";
    mockAxios.get.mockResolvedValue({ data: { results: TAXONOMY_TREE } });
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("etsy_get_taxonomy_nodes");
    });

    it("requires query field", () => {
      expect(definition.inputSchema.required).toContain("query");
    });
  });

  describe("handler", () => {
    it("fetches taxonomy nodes from Etsy API with api-key header", async () => {
      await handler({ query: "dress" });
      expect(mockAxios.get).toHaveBeenCalledOnce();
      const [url, config] = mockAxios.get.mock.calls[0];
      expect(url).toContain("seller-taxonomy/nodes");
      expect((config as Record<string, unknown>).headers).toMatchObject({
        "x-api-key": "test-etsy-api-key",
      });
    });

    it("filters nodes matching query (case-insensitive) by name", async () => {
      const result = await handler({ query: "DRESS" }) as Array<{ name: string }>;
      const names = result.map((r) => r.name);
      expect(names).toContain("Dresses");
      expect(names).toContain("Vintage Dress");
      expect(names).not.toContain("Jewelry");
    });

    it("filters nodes matching query in full path", async () => {
      // "clothing" is in the fullPath of children but not in the direct names Dresses/Vintage Dress
      const result = await handler({ query: "clothing" }) as Array<{ name: string }>;
      const names = result.map((r) => r.name);
      expect(names).toContain("Clothing");
      expect(names).toContain("Dresses");
      expect(names).toContain("Vintage Dress");
    });

    it("builds fullPath with ancestor chain", async () => {
      const result = await handler({ query: "vintage" }) as Array<{ taxonomyId: number; fullPath: string }>;
      const vintageNode = result.find((n) => n.taxonomyId === 100);
      expect(vintageNode?.fullPath).toBe("Clothing > Dresses > Vintage Dress");
    });

    it("includes level in the result", async () => {
      const result = await handler({ query: "necklaces" }) as Array<{ level: number; name: string }>;
      const necklace = result.find((n) => n.name === "Necklaces");
      expect(necklace?.level).toBe(2);
    });

    it("respects the limit parameter", async () => {
      const result = await handler({ query: "clothing", limit: 1 });
      expect((result as unknown[]).length).toBe(1);
    });

    it("defaults to limit 10", async () => {
      // Create a tree with more than 10 matching nodes
      const bigTree = Array.from({ length: 15 }, (_, i) => ({
        id: i + 1,
        level: 1,
        name: `Item ${i + 1}`,
        parent_id: null,
        children: [],
      }));
      mockAxios.get.mockResolvedValueOnce({ data: { results: bigTree } });

      const result = await handler({ query: "item" });
      expect((result as unknown[]).length).toBe(10);
    });

    it("returns empty array when no nodes match the query", async () => {
      const result = await handler({ query: "zzznomatch" });
      expect(result).toEqual([]);
    });

    it("propagates axios errors", async () => {
      mockAxios.get.mockRejectedValueOnce(new Error("Etsy API unavailable"));
      await expect(handler({ query: "dress" })).rejects.toThrow("Etsy API unavailable");
    });
  });
});
