import { vi, describe, it, expect, beforeEach } from "vitest";
import axios from "axios";
import * as fs from "fs";
import { handler, definition } from "../../tools/geminiResearch.js";

vi.mock("fs");
vi.mock("axios");

const mockAxios = vi.mocked(axios, true);
const mockFs = vi.mocked(fs);

const FAKE_IMAGE_BUFFER = Buffer.from("fake-image-bytes");
const FAKE_IMAGE_BASE64 = FAKE_IMAGE_BUFFER.toString("base64");

const FAKE_RAW_TEXT = `ITEM_DESCRIPTION: Vintage 1960s Pyrex Cinderella mixing bowl, pink with white snowflake pattern
CATEGORY: Vintage Kitchenware
WEB_FINDINGS: Comparable bowls sell for $25-$60 on eBay and Etsy. The pink snowflake pattern was produced 1956-1968. Collector demand is strong for complete sets.
SOURCES: https://replacements.com/pyrex, https://ebay.com/sch/pyrex-pink`;

function makeGeminiResponse(text: string) {
  return {
    data: {
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    },
  };
}

describe("gemini_item_research", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(FAKE_IMAGE_BUFFER);
    process.env.GEMINI_API_KEY = "test-gemini-key";
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("gemini_item_research");
    });

    it("requires imagePaths but not context", () => {
      expect(definition.inputSchema.required).toContain("imagePaths");
      expect(definition.inputSchema.required).not.toContain("context");
    });
  });

  describe("handler — request", () => {
    it("posts to Gemini API URL with API key", async () => {
      mockAxios.post.mockResolvedValueOnce(makeGeminiResponse(FAKE_RAW_TEXT));

      await handler({ imagePaths: ["/fake/photo.jpg"] });

      expect(mockAxios.post).toHaveBeenCalledOnce();
      const [url] = mockAxios.post.mock.calls[0];
      expect(url).toContain("generativelanguage.googleapis.com");
      expect(url).toContain("gemini-3.5-flash");
      expect(url).toContain("test-gemini-key");
    });

    it("includes one inlineData part per image path", async () => {
      mockAxios.post.mockResolvedValueOnce(makeGeminiResponse(FAKE_RAW_TEXT));

      await handler({ imagePaths: ["/fake/photo1.jpg", "/fake/photo2.jpg"] });

      const [, body] = mockAxios.post.mock.calls[0];
      const parts = (body as { contents: Array<{ parts: unknown[] }> }).contents[0].parts;
      const imageParts = parts.slice(0, 2) as Array<{ inlineData: { mimeType: string; data: string } }>;

      expect(imageParts).toHaveLength(2);
      expect(imageParts[0].inlineData.data).toBe(FAKE_IMAGE_BASE64);
      expect(imageParts[1].inlineData.data).toBe(FAKE_IMAGE_BASE64);
    });

    it("detects PNG MIME type from file extension", async () => {
      mockAxios.post.mockResolvedValueOnce(makeGeminiResponse(FAKE_RAW_TEXT));

      await handler({ imagePaths: ["/fake/photo.png"] });

      const [, body] = mockAxios.post.mock.calls[0];
      const parts = (body as { contents: Array<{ parts: unknown[] }> }).contents[0].parts;
      const imagePart = parts[0] as { inlineData: { mimeType: string } };
      expect(imagePart.inlineData.mimeType).toBe("image/png");
    });

    it("places the text prompt as the last part", async () => {
      mockAxios.post.mockResolvedValueOnce(makeGeminiResponse(FAKE_RAW_TEXT));

      await handler({ imagePaths: ["/fake/photo.jpg"] });

      const [, body] = mockAxios.post.mock.calls[0];
      const parts = (body as { contents: Array<{ parts: unknown[] }> }).contents[0].parts;
      const lastPart = parts[parts.length - 1] as { text?: string };
      expect(typeof lastPart.text).toBe("string");
      expect(lastPart.text).toContain("ITEM_DESCRIPTION:");
    });

    it("includes context in the text prompt when provided", async () => {
      mockAxios.post.mockResolvedValueOnce(makeGeminiResponse(FAKE_RAW_TEXT));

      await handler({ imagePaths: ["/fake/photo.jpg"], context: "Visible text: Made in Japan" });

      const [, body] = mockAxios.post.mock.calls[0];
      const parts = (body as { contents: Array<{ parts: unknown[] }> }).contents[0].parts;
      const textPart = parts[parts.length - 1] as { text: string };
      expect(textPart.text).toContain("Made in Japan");
    });

    it("includes Google Search grounding tool", async () => {
      mockAxios.post.mockResolvedValueOnce(makeGeminiResponse(FAKE_RAW_TEXT));

      await handler({ imagePaths: ["/fake/photo.jpg"] });

      const [, body] = mockAxios.post.mock.calls[0];
      expect((body as { tools: unknown[] }).tools).toEqual([{ googleSearch: {} }]);
    });
  });

  describe("handler — response", () => {
    it("parses all four labeled fields from rawText", async () => {
      mockAxios.post.mockResolvedValueOnce(makeGeminiResponse(FAKE_RAW_TEXT));

      const result = (await handler({ imagePaths: ["/fake/photo.jpg"] })) as Record<string, unknown>;

      expect(result.itemDescription).toContain("Pyrex");
      expect(result.suggestedCategory).toBe("Vintage Kitchenware");
      expect(result.webFindings).toContain("$25-$60");
      expect(result.rawText).toBe(FAKE_RAW_TEXT);
    });

    it("splits sources into a trimmed array and excludes 'none'", async () => {
      mockAxios.post.mockResolvedValueOnce(makeGeminiResponse(FAKE_RAW_TEXT));

      const result = (await handler({ imagePaths: ["/fake/photo.jpg"] })) as { sources: string[] };

      expect(result.sources).toEqual([
        "https://replacements.com/pyrex",
        "https://ebay.com/sch/pyrex-pink",
      ]);
    });

    it("returns empty sources array when SOURCES field is 'none'", async () => {
      const text = FAKE_RAW_TEXT.replace(
        /SOURCES:.+$/s,
        "SOURCES: none"
      );
      mockAxios.post.mockResolvedValueOnce(makeGeminiResponse(text));

      const result = (await handler({ imagePaths: ["/fake/photo.jpg"] })) as { sources: string[] };
      expect(result.sources).toEqual([]);
    });

    it("returns error object without calling axios when GEMINI_API_KEY is missing", async () => {
      delete process.env.GEMINI_API_KEY;

      const result = (await handler({ imagePaths: ["/fake/photo.jpg"] })) as { error: string };

      expect(result.error).toContain("GEMINI_API_KEY");
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it("returns error object without calling axios when imagePaths is empty", async () => {
      const result = (await handler({ imagePaths: [] })) as { error: string };

      expect(result.error).toContain("imagePaths");
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it("returns empty fields when candidates array is empty", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { candidates: [] },
      });

      const result = (await handler({ imagePaths: ["/fake/photo.jpg"] })) as Record<string, unknown>;

      expect(result.itemDescription).toBe("");
      expect(result.suggestedCategory).toBe("");
      expect(result.webFindings).toBe("");
      expect(result.sources).toEqual([]);
      expect(result.rawText).toBe("");
    });

    it("returns error object on 429 rate limit without throwing", async () => {
      const rateLimitError = Object.assign(new Error("Request failed") as import("axios").AxiosError, {
        isAxiosError: true,
        response: { status: 429, data: {}, headers: {}, config: {} as never, statusText: "" },
      });
      mockAxios.isAxiosError = vi.fn().mockReturnValue(true);
      mockAxios.post.mockRejectedValueOnce(rateLimitError);

      const result = (await handler({ imagePaths: ["/fake/photo.jpg"] })) as { error: string };
      expect(result.error).toContain("429");
    });

    it("propagates non-429 axios errors", async () => {
      mockAxios.post.mockRejectedValueOnce(new Error("network error"));
      await expect(handler({ imagePaths: ["/fake/photo.jpg"] })).rejects.toThrow("network error");
    });
  });
});
