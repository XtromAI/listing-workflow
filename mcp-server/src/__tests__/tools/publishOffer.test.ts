import { vi, describe, it, expect, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import { handler, definition } from "../../tools/publishOffer.js";

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

describe("ebay_publish_offer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios.post.mockResolvedValue({ data: { listingId: "12345678901" } });
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("ebay_publish_offer");
    });

    it("requires offerId field", () => {
      expect(definition.inputSchema.required).toContain("offerId");
    });
  });

  describe("handler", () => {
    it("returns listingId and listingUrl", async () => {
      const result = await handler({ offerId: "offer-abc" }) as Record<string, string>;
      expect(result.listingId).toBe("12345678901");
      expect(result.listingUrl).toBe("https://www.ebay.com/itm/12345678901");
    });

    it("calls the publish endpoint with the offerId", async () => {
      await handler({ offerId: "offer-abc" });
      const [url] = mockAxios.post.mock.calls[0];
      expect(url).toContain("/offer/offer-abc/publish");
    });

    it("URL-encodes the offerId in the endpoint path", async () => {
      await handler({ offerId: "offer/with spaces" });
      const [url] = mockAxios.post.mock.calls[0];
      expect(url).toContain(encodeURIComponent("offer/with spaces"));
    });

    it("sends Authorization header with bearer token", async () => {
      await handler({ offerId: "offer-abc" });
      const [, , config] = mockAxios.post.mock.calls[0];
      expect((config as Record<string, unknown>).headers).toMatchObject({
        Authorization: "Bearer mock-token",
      });
    });

    it("posts an empty body to the publish endpoint", async () => {
      await handler({ offerId: "offer-abc" });
      const [, body] = mockAxios.post.mock.calls[0];
      expect(body).toEqual({});
    });

    it("constructs correct eBay listing URL from listingId", async () => {
      mockAxios.post.mockResolvedValueOnce({ data: { listingId: "98765432100" } });
      const result = await handler({ offerId: "offer-xyz" }) as Record<string, string>;
      expect(result.listingUrl).toBe("https://www.ebay.com/itm/98765432100");
    });

    it("throws formatted eBay Publish API error on AxiosError with response", async () => {
      mockAxios.post.mockRejectedValueOnce(makeAxiosError(409, { errors: [{ message: "Offer already published" }] }));
      await expect(handler({ offerId: "offer-abc" })).rejects.toThrow("eBay Publish API 409:");
    });

    it("re-throws non-axios errors unchanged", async () => {
      const networkError = new Error("timeout");
      mockAxios.post.mockRejectedValueOnce(networkError);
      await expect(handler({ offerId: "offer-abc" })).rejects.toThrow("timeout");
    });
  });
});
