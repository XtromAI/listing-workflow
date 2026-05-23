import { vi, describe, it, expect, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import { handler, definition } from "../../tools/createOffer.js";

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
  categoryId: "112529",
  price: 49.99,
  currency: "USD",
  listingDescription: "<p>Great headphones</p>",
};

describe("ebay_create_offer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EBAY_FULFILLMENT_POLICY_ID = "fp-123";
    process.env.EBAY_PAYMENT_POLICY_ID = "pp-456";
    process.env.EBAY_RETURN_POLICY_ID = "rp-789";
    process.env.EBAY_MERCHANT_LOCATION_KEY = "location-001";
    mockAxios.post.mockResolvedValue({ data: { offerId: "offer-abc" } });
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("ebay_create_offer");
    });

    it("requires sku, categoryId, price, currency, and listingDescription", () => {
      const required = definition.inputSchema.required;
      expect(required).toContain("sku");
      expect(required).toContain("categoryId");
      expect(required).toContain("price");
      expect(required).toContain("currency");
      expect(required).toContain("listingDescription");
    });
  });

  describe("handler", () => {
    it("returns offerId from the API response", async () => {
      const result = await handler(BASE_ARGS) as Record<string, string>;
      expect(result.offerId).toBe("offer-abc");
    });

    it("posts to the offer endpoint with correct body", async () => {
      await handler(BASE_ARGS);

      const [url, body] = mockAxios.post.mock.calls[0];
      expect(url).toContain("/sell/inventory/v1/offer");
      expect(body).toMatchObject({
        sku: "SKU-001",
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        listingDescription: "<p>Great headphones</p>",
        pricingSummary: { price: { value: "49.99", currency: "USD" } },
        categoryId: "112529",
      });
    });

    it("reads listing policy IDs from environment variables", async () => {
      await handler(BASE_ARGS);
      const [, body] = mockAxios.post.mock.calls[0];
      expect((body as Record<string, unknown>).listingPolicies).toEqual({
        fulfillmentPolicyId: "fp-123",
        paymentPolicyId: "pp-456",
        returnPolicyId: "rp-789",
      });
    });

    it("reads merchantLocationKey from environment variable", async () => {
      await handler(BASE_ARGS);
      const [, body] = mockAxios.post.mock.calls[0];
      expect((body as Record<string, unknown>).merchantLocationKey).toBe("location-001");
    });

    it("defaults quantity to 1 when not provided", async () => {
      await handler(BASE_ARGS);
      const [, body] = mockAxios.post.mock.calls[0];
      expect((body as Record<string, unknown>).availableQuantity).toBe(1);
    });

    it("uses provided quantity when specified", async () => {
      await handler({ ...BASE_ARGS, quantity: 3 });
      const [, body] = mockAxios.post.mock.calls[0];
      expect((body as Record<string, unknown>).availableQuantity).toBe(3);
    });

    it("converts price to string in request body", async () => {
      await handler({ ...BASE_ARGS, price: 99.95 });
      const [, body] = mockAxios.post.mock.calls[0];
      expect(((body as Record<string, unknown>).pricingSummary as Record<string, unknown>).price).toMatchObject({
        value: "99.95",
        currency: "USD",
      });
    });

    it("sends Authorization and Content-Language headers", async () => {
      await handler(BASE_ARGS);
      const [, , config] = mockAxios.post.mock.calls[0];
      expect((config as Record<string, unknown>).headers).toMatchObject({
        Authorization: "Bearer mock-token",
        "Content-Language": "en-US",
      });
    });

    it("throws formatted eBay Offer API error on AxiosError with response", async () => {
      mockAxios.post.mockRejectedValueOnce(makeAxiosError(422, { errors: [{ message: "SKU not found" }] }));
      await expect(handler(BASE_ARGS)).rejects.toThrow("eBay Offer API 422:");
    });

    it("re-throws non-axios errors unchanged", async () => {
      const networkError = new Error("ECONNREFUSED");
      mockAxios.post.mockRejectedValueOnce(networkError);
      await expect(handler(BASE_ARGS)).rejects.toThrow("ECONNREFUSED");
    });
  });
});
