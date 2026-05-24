import { vi, describe, it, expect, beforeEach } from "vitest";
import axios from "axios";
import { handler, definition } from "../../tools/searchListings.js";

vi.mock("axios");
vi.mock("../../auth/oauth.js", () => ({
  getAccessToken: vi.fn().mockResolvedValue("mock-token"),
  getEbayBaseUrl: vi.fn().mockReturnValue("https://api.ebay.com"),
}));

const mockAxios = vi.mocked(axios, true);

const makeSoldResponse = (items: unknown[] = []) => ({
  data: {
    findCompletedItemsResponse: [
      {
        ack: ["Success"],
        searchResult: [{ item: items }],
      },
    ],
  },
});

const makeActiveResponse = (items: unknown[] = []) => ({
  data: {
    findItemsByKeywordsResponse: [
      {
        ack: ["Success"],
        searchResult: [{ item: items }],
      },
    ],
  },
});

const sampleItem = {
  title: ["Vintage Camera"],
  sellingStatus: [{ currentPrice: [{ "@currencyId": "USD", __value__: "45.00" }] }],
  condition: [{ conditionDisplayName: ["Used"] }],
  listingInfo: [{ endTime: ["2024-01-15T00:00:00.000Z"] }],
  viewItemURL: ["https://www.ebay.com/itm/123456"],
};

describe("ebay_search_listings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EBAY_CLIENT_ID = "test-app-id";
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("ebay_search_listings");
    });

    it("requires keywords field", () => {
      expect(definition.inputSchema.required).toContain("keywords");
    });
  });

  describe("handler — sold mode", () => {
    it("calls findCompletedItems with SoldItemsOnly filter", async () => {
      mockAxios.get.mockResolvedValueOnce(makeSoldResponse());

      await handler({ keywords: "vintage camera", soldOnly: true });

      expect(mockAxios.get).toHaveBeenCalledOnce();
      const [url, config] = mockAxios.get.mock.calls[0];
      expect(url).toContain("svcs.ebay.com");
      const params = (config as Record<string, unknown>).params as Record<string, unknown>;
      expect(params["OPERATION-NAME"]).toBe("findCompletedItems");
      expect(params["SECURITY-APPNAME"]).toBe("test-app-id");
      expect(params["itemFilter(0).name"]).toBe("SoldItemsOnly");
      expect(params["itemFilter(0).value"]).toBe("true");
      expect(params.keywords).toBe("vintage camera");
    });

    it("defaults to sold mode when soldOnly is omitted", async () => {
      mockAxios.get.mockResolvedValueOnce(makeSoldResponse());

      await handler({ keywords: "vintage camera" });

      const params = (mockAxios.get.mock.calls[0][1] as Record<string, unknown>).params as Record<string, unknown>;
      expect(params["OPERATION-NAME"]).toBe("findCompletedItems");
      expect(params["itemFilter(0).name"]).toBe("SoldItemsOnly");
    });

    it("maps sold response fields correctly", async () => {
      mockAxios.get.mockResolvedValueOnce(makeSoldResponse([sampleItem]));

      const result = await handler({ keywords: "vintage camera", soldOnly: true }) as Array<Record<string, unknown>>;

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        title: "Vintage Camera",
        price: "45.00",
        currency: "USD",
        condition: "Used",
        endDate: "2024-01-15T00:00:00.000Z",
        itemWebUrl: "https://www.ebay.com/itm/123456",
      });
    });
  });

  describe("handler — active mode", () => {
    it("calls findItemsByKeywords without SoldItemsOnly filter", async () => {
      mockAxios.get.mockResolvedValueOnce(makeActiveResponse());

      await handler({ keywords: "vintage camera", soldOnly: false });

      const params = (mockAxios.get.mock.calls[0][1] as Record<string, unknown>).params as Record<string, unknown>;
      expect(params["OPERATION-NAME"]).toBe("findItemsByKeywords");
      expect(params).not.toHaveProperty("itemFilter(0).name");
      expect(params).not.toHaveProperty("itemFilter(0).value");
      expect(params.sortOrder).toBe("BestMatch");
    });

    it("maps active response fields correctly", async () => {
      mockAxios.get.mockResolvedValueOnce(makeActiveResponse([sampleItem]));

      const result = await handler({ keywords: "vintage camera", soldOnly: false }) as Array<Record<string, unknown>>;

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Vintage Camera");
      expect(result[0].price).toBe("45.00");
      expect(result[0].itemWebUrl).toBe("https://www.ebay.com/itm/123456");
    });
  });

  describe("handler — edge cases", () => {
    it("returns empty array when no items in searchResult", async () => {
      mockAxios.get.mockResolvedValueOnce(makeSoldResponse([]));

      const result = await handler({ keywords: "obscure item" });
      expect(result).toEqual([]);
    });

    it("returns empty array when searchResult item key is absent", async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          findCompletedItemsResponse: [
            { ack: ["Success"], searchResult: [{}] },
          ],
        },
      });

      const result = await handler({ keywords: "obscure item" });
      expect(result).toEqual([]);
    });

    it("throws when ack is Failure", async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          findCompletedItemsResponse: [
            {
              ack: ["Failure"],
              errorMessage: [{ error: [{ message: ["Invalid app ID"] }] }],
            },
          ],
        },
      });

      await expect(handler({ keywords: "test" })).rejects.toThrow("Finding API error");
    });

    it("propagates axios errors", async () => {
      mockAxios.get.mockRejectedValueOnce(new Error("network error"));
      await expect(handler({ keywords: "test" })).rejects.toThrow("network error");
    });

    it("respects limit param", async () => {
      mockAxios.get.mockResolvedValueOnce(makeSoldResponse());

      await handler({ keywords: "camera", limit: 10 });

      const params = (mockAxios.get.mock.calls[0][1] as Record<string, unknown>).params as Record<string, unknown>;
      expect(params["paginationInput.entriesPerPage"]).toBe(10);
    });
  });
});
