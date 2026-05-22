import { vi, describe, it, expect, beforeEach } from "vitest";
import axios from "axios";
import * as fs from "fs";
import { handler, definition } from "../../tools/visionDetect.js";

vi.mock("fs");
vi.mock("axios");

const mockAxios = vi.mocked(axios, true);
const mockFs = vi.mocked(fs);

const FAKE_IMAGE_BUFFER = Buffer.from("fake-image-bytes");
const FAKE_IMAGE_BASE64 = FAKE_IMAGE_BUFFER.toString("base64");

describe("google_vision_web_detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(FAKE_IMAGE_BUFFER);
    process.env.GOOGLE_VISION_API_KEY = "test-vision-key";
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("google_vision_web_detection");
    });

    it("requires imagePath field", () => {
      expect(definition.inputSchema.required).toContain("imagePath");
    });
  });

  describe("handler", () => {
    it("reads the image and posts base64 to Google Vision API", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { responses: [{ webDetection: {} }] },
      });

      await handler({ imagePath: "/fake/photo.jpg" });

      expect(mockFs.readFileSync).toHaveBeenCalledWith("/fake/photo.jpg");
      expect(mockAxios.post).toHaveBeenCalledOnce();

      const [url, body] = mockAxios.post.mock.calls[0];
      expect(url).toContain("vision.googleapis.com");
      expect(url).toContain("test-vision-key");
      expect(((body as Record<string, unknown>).requests as Array<Record<string, unknown>>)[0].image).toEqual({
        content: FAKE_IMAGE_BASE64,
      });
      expect(((body as Record<string, unknown>).requests as Array<Record<string, unknown>>)[0].features).toEqual([
        { type: "WEB_DETECTION" },
      ]);
    });

    it("maps bestGuessLabels, webEntities, and pagesWithMatchingImages", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: {
          responses: [
            {
              webDetection: {
                bestGuessLabels: [{ label: "Sony WH-1000XM4" }],
                webEntities: [
                  { description: "Headphones", score: 0.95 },
                  { description: "Sony", score: 0.88 },
                ],
                pagesWithMatchingImages: [
                  { url: "https://example.com/page1", pageTitle: "Sony Headphones" },
                  { url: "https://example.com/page2" },
                ],
              },
            },
          ],
        },
      });

      const result = await handler({ imagePath: "/fake/photo.jpg" }) as Record<string, unknown>;

      expect(result.bestGuessLabels).toEqual(["Sony WH-1000XM4"]);
      expect(result.webEntities).toEqual([
        { description: "Headphones", score: 0.95 },
        { description: "Sony", score: 0.88 },
      ]);
      expect(result.pagesWithMatchingImages).toEqual([
        { url: "https://example.com/page1", pageTitle: "Sony Headphones" },
        { url: "https://example.com/page2", pageTitle: null },
      ]);
    });

    it("returns empty arrays when webDetection fields are absent", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { responses: [{ webDetection: {} }] },
      });

      const result = await handler({ imagePath: "/fake/photo.jpg" }) as Record<string, unknown[]>;

      expect(result.bestGuessLabels).toEqual([]);
      expect(result.webEntities).toEqual([]);
      expect(result.pagesWithMatchingImages).toEqual([]);
    });

    it("handles empty Vision API response gracefully", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { responses: [{}] },
      });

      const result = await handler({ imagePath: "/fake/photo.jpg" }) as Record<string, unknown[]>;
      expect(result.bestGuessLabels).toEqual([]);
    });

    it("propagates axios errors", async () => {
      mockAxios.post.mockRejectedValueOnce(new Error("Vision API error"));
      await expect(handler({ imagePath: "/fake/photo.jpg" })).rejects.toThrow("Vision API error");
    });
  });
});
