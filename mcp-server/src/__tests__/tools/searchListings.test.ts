import { vi, describe, it, expect, beforeEach } from "vitest";
import axios from "axios";
import { handler, definition } from "../../tools/searchListings.js";

vi.mock("axios");
vi.mock("../../auth/oauth.js", () => ({
  getAccessToken: vi.fn().mockResolvedValue("mock-token"),
  getEbayBaseUrl: vi.fn().mockReturnValue("https://api.ebay.com"),
}));

const mockAxios = vi.mocked(axios, true);

const soldItem = {
  title: "Vintage Pyrex Bowl",
  lastSoldPrice: { value: "45.00", currency: "USD" },
  lastSoldDate: "2024-01-15T00:00:00.000Z",
  condition: "Used",
  itemWebUrl: "https://www.ebay.com/itm/123456",
};

const activeItem = {
  title: "Vintage Pyrex Bowl",
  price: { value: "60.00", currency: "USD" },
  condition: "Used",
  itemWebUrl: "https://www.ebay.com/itm/789012",
};

describe("ebay_search_listings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("ebay_search_listings");
    });

    it("requires keywords field", () => {
      expect(definition.inputSchema.required).toContain("keywords");
    });
  });

  describe("handler — sold mode (Marketplace Insights API)", () => {
    it("calls the Marketplace Insights endpoint with correct params", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: { itemSales: [] } });

      await handler({ keywords: "pyrex bowl", soldOnly: true, limit: 3 });

      expect(mockAxios.get).toHaveBeenCalledOnce();
      const [url, config] = mockAxios.get.mock.calls[0];
      expect(url).toContain("marketplace_insights");
      expect(url).toContain("item_sales/search");
      expect((config as Record<string, unknown>).params).toMatchObject({ q: "pyrex bowl", limit: 3 });
      expect((config as Record<string, unknown>).headers).toMatchObject({
        Authorization: "Bearer mock-token",
      });
    });

    it("defaults to sold mode when soldOnly is omitted", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: { itemSales: [] } });

      await handler({ keywords: "pyrex bowl" });

      const [url] = mockAxios.get.mock.calls[0];
      expect(url).toContain("marketplace_insights");
    });

    it("maps sold response fields correctly", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: { itemSales: [soldItem] } });

      const result = await handler({ keywords: "pyrex bowl", soldOnly: true }) as Array<Record<string, unknown>>;

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        title: "Vintage Pyrex Bowl",
        price: "45.00",
        currency: "USD",
        condition: "Used",
        endDate: "2024-01-15T00:00:00.000Z",
        itemWebUrl: "https://www.ebay.com/itm/123456",
      });
    });

    it("returns empty array when itemSales is absent", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: {} });

      const result = await handler({ keywords: "obscure item", soldOnly: true });
      expect(result).toEqual([]);
    });

    it("returns graceful error on 403", async () => {
      const err = Object.assign(new Error("Forbidden"), {
        isAxiosError: true,
        response: { status: 403, data: {}, headers: {}, config: {} as never, statusText: "" },
      });
      mockAxios.get.mockRejectedValueOnce(err);
      mockAxios.isAxiosError = vi.fn().mockReturnValue(true) as unknown as typeof mockAxios.isAxiosError;

      const result = await handler({ keywords: "test", soldOnly: true }) as { error: string };
      expect(result.error).toContain("Marketplace Insights API");
    });
  });

  describe("handler — active mode (Browse API)", () => {
    it("calls the Browse search endpoint with correct params", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: { itemSummaries: [] } });

      await handler({ keywords: "pyrex bowl", soldOnly: false, limit: 3 });

      const [url, config] = mockAxios.get.mock.calls[0];
      expect(url).toContain("browse");
      expect(url).toContain("item_summary/search");
      expect((config as Record<string, unknown>).params).toMatchObject({ q: "pyrex bowl", limit: 3 });
    });

    it("maps active response fields correctly", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: { itemSummaries: [activeItem] } });

      const result = await handler({ keywords: "pyrex bowl", soldOnly: false }) as Array<Record<string, unknown>>;

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        title: "Vintage Pyrex Bowl",
        price: "60.00",
        currency: "USD",
        condition: "Used",
        endDate: null,
        itemWebUrl: "https://www.ebay.com/itm/789012",
      });
    });

    it("returns empty array when itemSummaries is absent", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: {} });

      const result = await handler({ keywords: "obscure item", soldOnly: false });
      expect(result).toEqual([]);
    });

    it("returns graceful error on 403", async () => {
      const err = Object.assign(new Error("Forbidden"), {
        isAxiosError: true,
        response: { status: 403, data: {}, headers: {}, config: {} as never, statusText: "" },
      });
      mockAxios.get.mockRejectedValueOnce(err);
      mockAxios.isAxiosError = vi.fn().mockReturnValue(true) as unknown as typeof mockAxios.isAxiosError;

      const result = await handler({ keywords: "test", soldOnly: false }) as { error: string };
      expect(result.error).toContain("Browse API");
    });
  });

  describe("handler — shared error handling", () => {
    it("wraps non-403 HTTP errors with status and body", async () => {
      const err = Object.assign(new Error("Server Error"), {
        isAxiosError: true,
        response: { status: 500, data: { errors: [{ message: "internal" }] }, headers: {}, config: {} as never, statusText: "" },
      });
      mockAxios.get.mockRejectedValueOnce(err);
      mockAxios.isAxiosError = vi.fn().mockReturnValue(true) as unknown as typeof mockAxios.isAxiosError;

      await expect(handler({ keywords: "test" })).rejects.toThrow("eBay API HTTP 500");
    });

    it("propagates non-axios errors unchanged", async () => {
      mockAxios.get.mockRejectedValueOnce(new Error("network error"));
      await expect(handler({ keywords: "test" })).rejects.toThrow("network error");
    });

    it("defaults limit to 5", async () => {
      mockAxios.get.mockResolvedValueOnce({ data: { itemSales: [] } });

      await handler({ keywords: "camera" });

      const params = (mockAxios.get.mock.calls[0][1] as Record<string, unknown>).params as Record<string, unknown>;
      expect(params.limit).toBe(5);
    });
  });
});
