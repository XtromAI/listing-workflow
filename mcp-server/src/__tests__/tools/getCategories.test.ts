import { vi, describe, it, expect, beforeEach } from "vitest";
import axios from "axios";
import { handler, definition } from "../../tools/getCategories.js";

vi.mock("axios");
vi.mock("../../auth/oauth.js", () => ({
  getAccessToken: vi.fn().mockResolvedValue("mock-token"),
  getEbayBaseUrl: vi.fn().mockReturnValue("https://api.ebay.com"),
}));

const mockAxios = vi.mocked(axios, true);

describe("ebay_get_category_suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("ebay_get_category_suggestions");
    });

    it("requires query field", () => {
      expect(definition.inputSchema.required).toContain("query");
    });
  });

  describe("handler", () => {
    it("calls the eBay taxonomy API with the query", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: { categorySuggestions: [] } });

      await handler({ query: "headphones" });

      expect(mockAxios.get).toHaveBeenCalledOnce();
      const [url, config] = mockAxios.get.mock.calls[0];
      expect(url).toContain("get_category_suggestions");
      expect((config as Record<string, unknown>).params).toEqual({ q: "headphones" });
      expect((config as Record<string, unknown>).headers).toMatchObject({
        Authorization: "Bearer mock-token",
      });
    });

    it("maps category suggestions to simplified format", async () => {
      // eBay returns ancestors leaf-to-root; the handler reverses them to build root-to-leaf path
      mockAxios.get.mockResolvedValueOnce({
        data: {
          categorySuggestions: [
            {
              category: { categoryId: "112529", categoryName: "Headphones" },
              categoryTreeNodeAncestors: [
                { categoryName: "Audio" },       // immediate parent
                { categoryName: "Electronics" }, // root
              ],
            },
          ],
        },
      });

      const result = await handler({ query: "headphones" });

      expect(result).toEqual([
        {
          categoryId: "112529",
          categoryName: "Headphones",
          fullPath: "Electronics > Audio > Headphones",
        },
      ]);
    });

    it("builds fullPath with ancestors in correct order (root to leaf)", async () => {
      // eBay ancestor array is leaf-to-root order; handler reverses to produce root-to-leaf
      mockAxios.get.mockResolvedValueOnce({
        data: {
          categorySuggestions: [
            {
              category: { categoryId: "999", categoryName: "Leaf" },
              categoryTreeNodeAncestors: [
                { categoryName: "Parent" }, // immediate parent (index 0)
                { categoryName: "Root" },   // root (index 1)
              ],
            },
          ],
        },
      });

      const result = await handler({ query: "test" }) as Array<{ fullPath: string }>;
      expect(result[0].fullPath).toBe("Root > Parent > Leaf");
    });

    it("uses categoryName alone as fullPath when no ancestors present", async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          categorySuggestions: [
            {
              category: { categoryId: "1", categoryName: "Top Level" },
            },
          ],
        },
      });

      const result = await handler({ query: "test" }) as Array<{ fullPath: string }>;
      expect(result[0].fullPath).toBe("Top Level");
    });

    it("returns empty array when no suggestions exist", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: {} });

      const result = await handler({ query: "obscure item" });
      expect(result).toEqual([]);
    });

    it("propagates axios errors", async () => {
      mockAxios.get.mockRejectedValueOnce(new Error("API error"));
      await expect(handler({ query: "test" })).rejects.toThrow("API error");
    });
  });
});
