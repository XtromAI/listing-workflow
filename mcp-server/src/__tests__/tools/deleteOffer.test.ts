import { vi, describe, it, expect, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import { handler, definition } from "../../tools/deleteOffer.js";

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

describe("ebay_delete_offer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios.delete.mockResolvedValue({ data: {} });
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("ebay_delete_offer");
    });

    it("requires offerId field", () => {
      expect(definition.inputSchema.required).toContain("offerId");
    });
  });

  describe("handler", () => {
    it("returns deleted true and the offerId", async () => {
      const result = await handler({ offerId: "offer-abc" }) as Record<string, unknown>;
      expect(result.deleted).toBe(true);
      expect(result.offerId).toBe("offer-abc");
    });

    it("calls the delete endpoint with the offerId", async () => {
      await handler({ offerId: "offer-abc" });
      const [url] = mockAxios.delete.mock.calls[0];
      expect(url).toContain("/offer/offer-abc");
    });

    it("URL-encodes the offerId in the endpoint path", async () => {
      await handler({ offerId: "offer/with spaces" });
      const [url] = mockAxios.delete.mock.calls[0];
      expect(url).toContain(encodeURIComponent("offer/with spaces"));
    });

    it("sends Authorization header with bearer token", async () => {
      await handler({ offerId: "offer-abc" });
      const [, config] = mockAxios.delete.mock.calls[0];
      expect((config as Record<string, unknown>).headers).toMatchObject({
        Authorization: "Bearer mock-token",
      });
    });

    it("throws formatted eBay Delete Offer API error on AxiosError with response", async () => {
      mockAxios.delete.mockRejectedValueOnce(
        makeAxiosError(404, { errors: [{ message: "Offer not found" }] })
      );
      await expect(handler({ offerId: "offer-abc" })).rejects.toThrow("eBay Delete Offer API 404:");
    });

    it("throws formatted error on 400 if offer is active", async () => {
      mockAxios.delete.mockRejectedValueOnce(
        makeAxiosError(400, { errors: [{ message: "Cannot delete a published offer" }] })
      );
      await expect(handler({ offerId: "offer-abc" })).rejects.toThrow("eBay Delete Offer API 400:");
    });

    it("re-throws non-axios errors unchanged", async () => {
      const networkError = new Error("timeout");
      mockAxios.delete.mockRejectedValueOnce(networkError);
      await expect(handler({ offerId: "offer-abc" })).rejects.toThrow("timeout");
    });
  });
});
