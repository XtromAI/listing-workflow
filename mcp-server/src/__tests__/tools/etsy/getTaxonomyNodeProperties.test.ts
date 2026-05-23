import { vi, describe, it, expect, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import { handler, definition } from "../../../tools/etsy/getTaxonomyNodeProperties.js";

vi.mock("axios");

const mockAxios = vi.mocked(axios, true);

function makeAxiosError(status: number, data: unknown): AxiosError {
  return Object.assign(new Error("Request failed") as AxiosError, {
    isAxiosError: true,
    response: { status, data, headers: {}, config: {} as never, statusText: "" },
  });
}

const MOCK_PROPERTIES = [
  {
    id: 200,
    name: "color",
    display_name: "Primary color",
    scales: [{ id: 1, display_name: "Color" }],
    is_required: true,
    supports_variations: true,
    property_values: [
      { id: 1, name: "Red", scale_id: 1 },
      { id: 2, name: "Blue", scale_id: 1 },
    ],
  },
  {
    id: 201,
    name: "size",
    display_name: "Size",
    scales: [],
    is_required: false,
    supports_variations: false,
    property_values: [],
  },
];

describe("etsy_get_taxonomy_node_properties", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ETSY_API_KEY = "test-etsy-api-key";
    mockAxios.get.mockResolvedValue({ data: { results: MOCK_PROPERTIES } });
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("etsy_get_taxonomy_node_properties");
    });

    it("requires taxonomyId field", () => {
      expect(definition.inputSchema.required).toContain("taxonomyId");
    });
  });

  describe("handler", () => {
    it("fetches properties for the given taxonomy node", async () => {
      await handler({ taxonomyId: 42 });
      const [url, config] = mockAxios.get.mock.calls[0];
      expect(url).toContain("seller-taxonomy/nodes/42/properties");
      expect((config as Record<string, unknown>).headers).toMatchObject({
        "x-api-key": "test-etsy-api-key",
      });
    });

    it("returns taxonomyId and mapped properties", async () => {
      const result = await handler({ taxonomyId: 42 }) as { taxonomyId: number; properties: Array<Record<string, unknown>> };

      expect(result.taxonomyId).toBe(42);
      expect(result.properties).toHaveLength(2);

      const color = result.properties[0];
      expect(color.id).toBe(200);
      expect(color.name).toBe("color");
      expect(color.displayName).toBe("Primary color");
      expect(color.required).toBe(true);
      expect(color.supportsVariations).toBe(true);
      expect(color.scales).toEqual([{ id: 1, name: "Color" }]);
      expect(color.possibleValues).toEqual([
        { id: 1, name: "Red" },
        { id: 2, name: "Blue" },
      ]);
    });

    it("maps optional properties with empty arrays correctly", async () => {
      const result = await handler({ taxonomyId: 42 }) as { properties: Array<Record<string, unknown>> };
      const size = result.properties[1];
      expect(size.required).toBe(false);
      expect(size.scales).toEqual([]);
      expect(size.possibleValues).toEqual([]);
    });

    it("returns empty properties array when API returns none", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: { results: [] } });
      const result = await handler({ taxonomyId: 99 }) as { properties: unknown[] };
      expect(result.properties).toEqual([]);
    });

    it("returns empty properties when results field is absent", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: {} });
      const result = await handler({ taxonomyId: 99 }) as { properties: unknown[] };
      expect(result.properties).toEqual([]);
    });

    it("throws formatted error on AxiosError with response", async () => {
      mockAxios.get.mockRejectedValueOnce(makeAxiosError(404, { error: "Not found" }));
      await expect(handler({ taxonomyId: 999 })).rejects.toThrow("Etsy Taxonomy API 404:");
    });

    it("re-throws non-axios errors unchanged", async () => {
      mockAxios.get.mockRejectedValueOnce(new Error("Connection refused"));
      await expect(handler({ taxonomyId: 42 })).rejects.toThrow("Connection refused");
    });
  });
});
