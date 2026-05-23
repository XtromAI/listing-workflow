import { vi, describe, it, expect, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import * as fs from "fs";
import { handler, definition } from "../../tools/searchByImage.js";

vi.mock("fs");
vi.mock("axios");
vi.mock("../../auth/oauth.js", () => ({
  getAccessToken: vi.fn().mockResolvedValue("mock-token"),
  getEbayBaseUrl: vi.fn().mockReturnValue("https://api.ebay.com"),
}));

const mockAxios = vi.mocked(axios, true);
const mockFs = vi.mocked(fs);

const FAKE_IMAGE_BUFFER = Buffer.from("fake-image-data");
const FAKE_IMAGE_BASE64 = FAKE_IMAGE_BUFFER.toString("base64");

describe("ebay_search_by_image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(FAKE_IMAGE_BUFFER);
    mockAxios.isAxiosError.mockImplementation(
      (err): err is AxiosError => typeof err === "object" && err !== null && "isAxiosError" in (err as object)
    );
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("ebay_search_by_image");
    });

    it("requires imagePath field", () => {
      expect(definition.inputSchema.required).toContain("imagePath");
    });
  });

  describe("handler", () => {
    it("reads image file and posts base64 to eBay Browse API", async () => {
      mockAxios.post.mockResolvedValueOnce({ data: { itemSummaries: [] } });

      await handler({ imagePath: "/fake/image.jpg" });

      expect(mockFs.readFileSync).toHaveBeenCalledWith("/fake/image.jpg");
      expect(mockAxios.post).toHaveBeenCalledOnce();
      const [url, body, config] = mockAxios.post.mock.calls[0];
      expect(url).toContain("search_by_image");
      expect((body as Record<string, unknown>).image).toBe(FAKE_IMAGE_BASE64);
      expect((config as Record<string, unknown>).headers).toMatchObject({
        Authorization: "Bearer mock-token",
      });
    });

    it("uses default limit of 10 when not specified", async () => {
      mockAxios.post.mockResolvedValueOnce({ data: { itemSummaries: [] } });
      await handler({ imagePath: "/fake/image.jpg" });
      const [, , config] = mockAxios.post.mock.calls[0];
      expect((config as Record<string, unknown>).params).toEqual({ limit: 10 });
    });

    it("passes custom limit to API", async () => {
      mockAxios.post.mockResolvedValueOnce({ data: { itemSummaries: [] } });
      await handler({ imagePath: "/fake/image.jpg", limit: 5 });
      const [, , config] = mockAxios.post.mock.calls[0];
      expect((config as Record<string, unknown>).params).toEqual({ limit: 5 });
    });

    it("maps item summaries to simplified format", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: {
          itemSummaries: [
            {
              title: "Sony WH-1000XM4",
              price: { value: "249.99", currency: "USD" },
              condition: "New",
              itemWebUrl: "https://www.ebay.com/itm/123",
            },
          ],
        },
      });

      const result = await handler({ imagePath: "/fake/image.jpg" }) as Array<Record<string, unknown>>;
      expect(result).toEqual([
        {
          title: "Sony WH-1000XM4",
          price: "USD 249.99",
          condition: "New",
          itemWebUrl: "https://www.ebay.com/itm/123",
        },
      ]);
    });

    it("returns null for missing price and condition", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: {
          itemSummaries: [
            {
              title: "Item without price",
              itemWebUrl: "https://www.ebay.com/itm/456",
            },
          ],
        },
      });

      const result = await handler({ imagePath: "/fake/image.jpg" }) as Array<Record<string, unknown>>;
      expect(result[0].price).toBeNull();
      expect(result[0].condition).toBeNull();
    });

    it("returns graceful fallback message on 403 (Browse API not approved)", async () => {
      const err = Object.assign(new Error("Forbidden") as AxiosError, {
        isAxiosError: true,
        response: { status: 403, data: {}, headers: {}, config: {} as never, statusText: "" },
      });
      mockAxios.post.mockRejectedValueOnce(err);

      const result = await handler({ imagePath: "/fake/image.jpg" }) as Record<string, string>;
      expect(result.error).toContain("Browse API access not yet approved");
    });

    it("re-throws non-403 axios errors", async () => {
      const err = Object.assign(new Error("Internal Server Error") as AxiosError, {
        isAxiosError: true,
        response: { status: 500, data: {}, headers: {}, config: {} as never, statusText: "" },
      });
      mockAxios.post.mockRejectedValueOnce(err);

      await expect(handler({ imagePath: "/fake/image.jpg" })).rejects.toThrow("Internal Server Error");
    });
  });
});
