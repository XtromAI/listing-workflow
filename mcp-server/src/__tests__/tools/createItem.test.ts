import { vi, describe, it, expect, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import { handler, definition } from "../../tools/createItem.js";

vi.mock("axios");
vi.mock("../../auth/oauth.js", () => ({
  getAccessToken: vi.fn().mockResolvedValue("mock-token"),
  getEbayBaseUrl: vi.fn().mockReturnValue("https://api.ebay.com"),
}));

const mockAxios = vi.mocked(axios, true);

function makeAxiosError(status: number, data: unknown): AxiosError {
  return Object.assign(new Error("Request failed") as AxiosError, {
    isAxiosError: true,
    response: { status, data, headers: {}, config: {} as never, statusText: "" },
  });
}

const BASE_ARGS = {
  sku: "SKU-001",
  title: "Sony WH-1000XM4 Headphones",
  description: "<p>Great headphones</p>",
  condition: "USED_EXCELLENT",
  weightLbs: 1.2,
};

describe("ebay_create_inventory_item", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios.put.mockResolvedValue({ status: 204 });
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("ebay_create_inventory_item");
    });

    it("requires sku, title, description, condition, and weightLbs", () => {
      const required = definition.inputSchema.required;
      expect(required).toContain("sku");
      expect(required).toContain("title");
      expect(required).toContain("description");
      expect(required).toContain("condition");
      expect(required).toContain("weightLbs");
    });

    it("exposes optional dimension properties in the schema", () => {
      const props = definition.inputSchema.properties;
      expect(props).toHaveProperty("packageLengthIn");
      expect(props).toHaveProperty("packageWidthIn");
      expect(props).toHaveProperty("packageHeightIn");
      expect(definition.inputSchema.required).not.toContain("packageLengthIn");
    });
  });

  describe("handler", () => {
    it("makes a PUT request to the inventory_item endpoint", async () => {
      await handler(BASE_ARGS);

      expect(mockAxios.put).toHaveBeenCalledOnce();
      const [url] = mockAxios.put.mock.calls[0];
      expect(url).toContain("/sell/inventory/v1/inventory_item/SKU-001");
    });

    it("URL-encodes the SKU in the endpoint path", async () => {
      await handler({ ...BASE_ARGS, sku: "SKU/WITH SPACES" });
      const [url] = mockAxios.put.mock.calls[0];
      expect(url).toContain(encodeURIComponent("SKU/WITH SPACES"));
    });

    it("returns { success: true } on successful PUT", async () => {
      const result = await handler(BASE_ARGS);
      expect(result).toEqual({ success: true });
    });

    it("sends Authorization and Content-Language headers", async () => {
      await handler(BASE_ARGS);
      const [, , config] = mockAxios.put.mock.calls[0];
      expect((config as Record<string, unknown>).headers).toMatchObject({
        Authorization: "Bearer mock-token",
        "Content-Language": "en-US",
      });
    });

    it("converts itemSpecifics to aspects array format", async () => {
      await handler({
        ...BASE_ARGS,
        itemSpecifics: { Brand: "Sony", Model: "WH-1000XM4" },
      });

      const [, body] = mockAxios.put.mock.calls[0];
      expect((body as Record<string, unknown>).product).toMatchObject({
        aspects: { Brand: ["Sony"], Model: ["WH-1000XM4"] },
      });
    });

    it("sends empty aspects when itemSpecifics is not provided", async () => {
      await handler(BASE_ARGS);
      const [, body] = mockAxios.put.mock.calls[0];
      expect((body as Record<string, unknown>).product).toMatchObject({ aspects: {} });
    });

    it("includes imageUrls in product when provided", async () => {
      await handler({
        ...BASE_ARGS,
        imageUrls: ["https://i.ebayimg.com/img1.jpg", "https://i.ebayimg.com/img2.jpg"],
      });

      const [, body] = mockAxios.put.mock.calls[0];
      expect((body as Record<string, unknown>).product).toMatchObject({
        imageUrls: ["https://i.ebayimg.com/img1.jpg", "https://i.ebayimg.com/img2.jpg"],
      });
    });

    it("omits imageUrls from product when not provided", async () => {
      await handler(BASE_ARGS);
      const [, body] = mockAxios.put.mock.calls[0];
      expect((body as Record<string, unknown>).product).not.toHaveProperty("imageUrls");
    });

    it("includes conditionDescription when provided", async () => {
      await handler({ ...BASE_ARGS, conditionDescription: "Minor scratch on right cup" });
      const [, body] = mockAxios.put.mock.calls[0];
      expect((body as Record<string, unknown>).conditionDescription).toBe("Minor scratch on right cup");
    });

    it("omits conditionDescription when not provided", async () => {
      await handler(BASE_ARGS);
      const [, body] = mockAxios.put.mock.calls[0];
      expect(body).not.toHaveProperty("conditionDescription");
    });

    it("sends packageWeightAndSize with weight in POUND unit and no dimensions when omitted", async () => {
      await handler({ ...BASE_ARGS, weightLbs: 2.5 });
      const [, body] = mockAxios.put.mock.calls[0];
      expect((body as Record<string, unknown>).packageWeightAndSize).toEqual({
        weight: { value: 2.5, unit: "POUND" },
      });
    });

    it("includes dimensions in packageWeightAndSize when all three are provided", async () => {
      await handler({
        ...BASE_ARGS,
        weightLbs: 2.5,
        packageLengthIn: 12,
        packageWidthIn: 8,
        packageHeightIn: 6,
      });
      const [, body] = mockAxios.put.mock.calls[0];
      expect((body as Record<string, unknown>).packageWeightAndSize).toEqual({
        weight: { value: 2.5, unit: "POUND" },
        dimensions: {
          length: 12,
          width: 8,
          height: 6,
          unit: "INCH",
        },
      });
    });

    it("omits dimensions when only some are provided", async () => {
      await handler({ ...BASE_ARGS, packageLengthIn: 12, packageWidthIn: 8 });
      const [, body] = mockAxios.put.mock.calls[0];
      expect((body as Record<string, unknown>).packageWeightAndSize).toEqual({
        weight: { value: 1.2, unit: "POUND" },
      });
    });

    it("sets availability quantity to 1", async () => {
      await handler(BASE_ARGS);
      const [, body] = mockAxios.put.mock.calls[0];
      expect((body as Record<string, unknown>).availability).toEqual({
        shipToLocationAvailability: { quantity: 1 },
      });
    });

    it("throws formatted eBay Inventory API error on AxiosError with response", async () => {
      mockAxios.put.mockRejectedValueOnce(makeAxiosError(400, { errors: [{ message: "Invalid SKU" }] }));
      await expect(handler(BASE_ARGS)).rejects.toThrow("eBay Inventory API 400:");
    });

    it("re-throws non-axios errors unchanged", async () => {
      const networkError = new Error("ECONNREFUSED");
      mockAxios.put.mockRejectedValueOnce(networkError);
      await expect(handler(BASE_ARGS)).rejects.toThrow("ECONNREFUSED");
    });
  });
});
