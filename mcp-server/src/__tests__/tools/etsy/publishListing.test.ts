import { vi, describe, it, expect, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import { handler, definition } from "../../../tools/etsy/publishListing.js";

vi.mock("axios");
vi.mock("../../../auth/etsy-oauth.js", () => ({
  getEtsyAccessToken: vi.fn().mockResolvedValue("mock-etsy-token"),
  ETSY_BASE_URL: "https://openapi.etsy.com/v3",
}));

const mockAxios = vi.mocked(axios, true);

function makeAxiosError(status: number, data: unknown): AxiosError {
  return Object.assign(new Error("Request failed") as AxiosError, {
    isAxiosError: true,
    response: { status, data, headers: {}, config: {} as never, statusText: "" },
  });
}

describe("etsy_publish_listing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ETSY_SHOP_ID = "12345678";
    process.env.ETSY_API_KEY = "test-etsy-api-key";
    mockAxios.patch.mockResolvedValue({
      data: {
        listing_id: 999001,
        url: "https://www.etsy.com/listing/999001/vintage-denim-jacket",
      },
    });
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("etsy_publish_listing");
    });

    it("requires listingId field", () => {
      expect(definition.inputSchema.required).toContain("listingId");
    });
  });

  describe("handler", () => {
    it("returns listingId and listingUrl", async () => {
      const result = await handler({ listingId: 999001 }) as Record<string, unknown>;
      expect(result.listingId).toBe(999001);
      expect(result.listingUrl).toBe("https://www.etsy.com/listing/999001/vintage-denim-jacket");
    });

    it("sends PATCH request to the shop listings endpoint", async () => {
      await handler({ listingId: 999001 });
      const [url] = mockAxios.patch.mock.calls[0];
      expect(url).toContain("/application/shops/12345678/listings/999001");
    });

    it("sets state to active in the request body", async () => {
      await handler({ listingId: 999001 });
      const [, body] = mockAxios.patch.mock.calls[0];
      expect((body as Record<string, unknown>).state).toBe("active");
    });

    it("sends Authorization, x-api-key, and Content-Type headers", async () => {
      await handler({ listingId: 999001 });
      const [, , config] = mockAxios.patch.mock.calls[0];
      expect((config as Record<string, unknown>).headers).toMatchObject({
        Authorization: "Bearer mock-etsy-token",
        "x-api-key": "test-etsy-api-key",
        "Content-Type": "application/json",
      });
    });

    it("throws formatted Etsy Listings API error on AxiosError with response", async () => {
      mockAxios.patch.mockRejectedValueOnce(makeAxiosError(422, { error: "Listing incomplete" }));
      await expect(handler({ listingId: 999001 })).rejects.toThrow("Etsy Listings API 422:");
    });

    it("re-throws non-axios errors unchanged", async () => {
      mockAxios.patch.mockRejectedValueOnce(new Error("network error"));
      await expect(handler({ listingId: 999001 })).rejects.toThrow("network error");
    });
  });
});
