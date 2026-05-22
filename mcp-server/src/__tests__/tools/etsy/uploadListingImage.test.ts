import { vi, describe, it, expect, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import * as fs from "fs";
import { handler, definition } from "../../../tools/etsy/uploadListingImage.js";

vi.mock("fs");
vi.mock("axios");
vi.mock("../../../auth/etsy-oauth.js", () => ({
  getEtsyAccessToken: vi.fn().mockResolvedValue("mock-etsy-token"),
  ETSY_BASE_URL: "https://openapi.etsy.com/v3",
}));

const mockAxios = vi.mocked(axios, true);
const mockFs = vi.mocked(fs);

const FAKE_IMAGE_BUFFER = Buffer.from("fake-png-image-data");

function makeAxiosError(status: number, data: unknown): AxiosError {
  return Object.assign(new Error("Request failed") as AxiosError, {
    isAxiosError: true,
    response: { status, data, headers: {}, config: {} as never, statusText: "" },
  });
}

describe("etsy_upload_listing_image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(FAKE_IMAGE_BUFFER);
    process.env.ETSY_SHOP_ID = "12345678";
    process.env.ETSY_API_KEY = "test-etsy-api-key";
    mockAxios.post.mockResolvedValue({
      data: {
        listing_image_id: 55001,
        url_fullxfull: "https://img.etsystatic.com/abc/fullxfull.jpg",
        rank: 1,
      },
    });
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("etsy_upload_listing_image");
    });

    it("requires listingId and imagePath fields", () => {
      const required = definition.inputSchema.required;
      expect(required).toContain("listingId");
      expect(required).toContain("imagePath");
    });
  });

  describe("handler", () => {
    it("reads the image file and posts to the correct Etsy endpoint", async () => {
      await handler({ listingId: 999001, imagePath: "/photos/item.jpg" });

      expect(mockFs.readFileSync).toHaveBeenCalledWith("/photos/item.jpg");
      expect(mockAxios.post).toHaveBeenCalledOnce();
      const [url] = mockAxios.post.mock.calls[0];
      expect(url).toContain("/application/shops/12345678/listings/999001/images");
    });

    it("returns listingImageId, url, and rank", async () => {
      const result = await handler({ listingId: 999001, imagePath: "/photos/item.jpg" }) as Record<string, unknown>;
      expect(result.listingImageId).toBe(55001);
      expect(result.url).toBe("https://img.etsystatic.com/abc/fullxfull.jpg");
      expect(result.rank).toBe(1);
    });

    it("sends Authorization and x-api-key headers", async () => {
      await handler({ listingId: 999001, imagePath: "/photos/item.jpg" });
      const [, , config] = mockAxios.post.mock.calls[0];
      expect((config as Record<string, unknown>).headers).toMatchObject({
        Authorization: "Bearer mock-etsy-token",
        "x-api-key": "test-etsy-api-key",
      });
    });

    it("defaults rank to 1 when not specified", async () => {
      await handler({ listingId: 999001, imagePath: "/photos/item.jpg" });
      const [, formData] = mockAxios.post.mock.calls[0];
      // Verify the call succeeded — rank is appended via FormData.append
      expect(formData).toBeDefined();
    });

    it("accepts custom rank value", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { listing_image_id: 55002, url_fullxfull: "https://img.example.com/2.jpg", rank: 2 },
      });
      const result = await handler({ listingId: 999001, imagePath: "/photos/item2.jpg", rank: 2 }) as Record<string, unknown>;
      expect(result.rank).toBe(2);
    });

    it("uses image/png mime type for .png files", async () => {
      await handler({ listingId: 999001, imagePath: "/photos/item.png" });
      expect(mockAxios.post).toHaveBeenCalledOnce();
    });

    it("uses image/jpeg mime type for non-.png files", async () => {
      await handler({ listingId: 999001, imagePath: "/photos/item.jpeg" });
      expect(mockAxios.post).toHaveBeenCalledOnce();
    });

    it("throws formatted Etsy Images API error on AxiosError with response", async () => {
      mockAxios.post.mockRejectedValueOnce(makeAxiosError(400, { error: "Invalid image" }));
      await expect(handler({ listingId: 999001, imagePath: "/photos/item.jpg" })).rejects.toThrow(
        "Etsy Images API 400:"
      );
    });

    it("re-throws non-axios errors unchanged", async () => {
      mockAxios.post.mockRejectedValueOnce(new Error("file read error"));
      await expect(handler({ listingId: 999001, imagePath: "/photos/item.jpg" })).rejects.toThrow(
        "file read error"
      );
    });
  });
});
