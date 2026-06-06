import { vi, describe, it, expect, beforeEach } from "vitest";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { handler, definition } from "../../tools/prepareListingPhoto.js";

vi.mock("axios");
vi.mock("fs");

// vi.hoisted ensures these are initialized before vi.mock("sharp") is processed
const { mockSharp, mockComposite, mockJpeg, mockToBuffer, mockMetadata } = vi.hoisted(() => {
  const mockToBuffer = vi.fn().mockResolvedValue(Buffer.from("final-image-bytes"));
  const mockJpeg = vi.fn().mockReturnValue({ toBuffer: mockToBuffer });
  const mockComposite = vi.fn().mockReturnValue({ jpeg: mockJpeg });
  const mockMetadata = vi.fn().mockResolvedValue({ width: 800, height: 600 });
  const mockSharpInstance = { metadata: mockMetadata, composite: mockComposite };
  const mockSharp = vi.fn().mockReturnValue(mockSharpInstance);
  return { mockSharp, mockComposite, mockJpeg, mockToBuffer, mockMetadata };
});

// Sharp mock — handles both call sites in the handler:
//   sharp(bytes).metadata()
//   sharp(bytes).composite([...]).jpeg({}).toBuffer()
vi.mock("sharp", () => ({ default: mockSharp }));

const mockAxios = vi.mocked(axios, true);
const mockFs = vi.mocked(fs);

const FAKE_IMAGE_BUFFER = Buffer.from("fake-image-bytes");
const FAKE_IMAGE_BASE64 = FAKE_IMAGE_BUFFER.toString("base64");
const FAKE_FONT_BUFFER = Buffer.from("fake-font-bytes");

const FAKE_ENHANCED_BYTES = Buffer.from("enhanced-image-bytes");
const FAKE_ENHANCED_BASE64 = FAKE_ENHANCED_BYTES.toString("base64");

function makeGeminiImageResponse(imageBase64 = FAKE_ENHANCED_BASE64) {
  return {
    data: {
      candidates: [
        {
          content: {
            parts: [
              { text: "Here is the enhanced image." },
              { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
            ],
          },
        },
      ],
    },
  };
}

describe("prepare_listing_photo", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";

    mockFs.readFileSync.mockImplementation((p: unknown) => {
      if (typeof p === "string" && p.endsWith(".ttf")) return FAKE_FONT_BUFFER;
      return FAKE_IMAGE_BUFFER;
    });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.writeFileSync.mockReturnValue(undefined);

    mockAxios.post.mockResolvedValue(makeGeminiImageResponse());
  });

  // ── definition ──────────────────────────────────────────────────────────────

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("prepare_listing_photo");
    });

    it("requires photos and outputDir", () => {
      expect(definition.inputSchema.required).toContain("photos");
      expect(definition.inputSchema.required).toContain("outputDir");
    });

    it("photos items require imagePath and label", () => {
      const itemSchema = (
        definition.inputSchema.properties.photos as { items: { required: string[] } }
      ).items;
      expect(itemSchema.required).toContain("imagePath");
      expect(itemSchema.required).toContain("label");
    });
  });

  // ── env var guards ───────────────────────────────────────────────────────────

  describe("handler — env var guards", () => {
    it("returns error and skips axios when GEMINI_API_KEY is missing", async () => {
      delete process.env.GEMINI_API_KEY;

      const result = (await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      })) as { error: string };

      expect(result.error).toContain("GEMINI_API_KEY");
      expect(mockAxios.post).not.toHaveBeenCalled();
    });

    it("returns error and skips axios when GEMINI_IMAGE_MODEL is missing", async () => {
      delete process.env.GEMINI_IMAGE_MODEL;

      const result = (await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      })) as { error: string };

      expect(result.error).toContain("GEMINI_IMAGE_MODEL");
      expect(mockAxios.post).not.toHaveBeenCalled();
    });
  });

  // ── Gemini request ───────────────────────────────────────────────────────────

  describe("handler — Gemini request", () => {
    it("posts to the correct Gemini URL with API key and model", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      });

      expect(mockAxios.post).toHaveBeenCalledOnce();
      const [url] = mockAxios.post.mock.calls[0];
      expect(url).toContain("generativelanguage.googleapis.com");
      expect(url).toContain("gemini-3.1-flash-image");
      expect(url).toContain("test-gemini-key");
    });

    it("sends the source image as inlineData in the request body", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      });

      const [, body] = mockAxios.post.mock.calls[0];
      const parts = (body as { contents: Array<{ parts: unknown[] }> }).contents[0].parts;
      const imagePart = parts.find(
        (p): p is { inlineData: { mimeType: string; data: string } } =>
          typeof (p as Record<string, unknown>).inlineData !== "undefined"
      );
      expect(imagePart?.inlineData.data).toBe(FAKE_IMAGE_BASE64);
      expect(imagePart?.inlineData.mimeType).toBe("image/jpeg");
    });

    it("detects PNG MIME type from file extension", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.png", label: "front" }],
        outputDir: "/out",
      });

      const [, body] = mockAxios.post.mock.calls[0];
      const parts = (body as { contents: Array<{ parts: unknown[] }> }).contents[0].parts;
      const imagePart = parts.find(
        (p): p is { inlineData: { mimeType: string; data: string } } =>
          typeof (p as Record<string, unknown>).inlineData !== "undefined"
      );
      expect(imagePart?.inlineData.mimeType).toBe("image/png");
    });

    it("sends a standard enhancement prompt for a normal photo", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      });

      const [, body] = mockAxios.post.mock.calls[0];
      const parts = (body as { contents: Array<{ parts: Array<{ text?: string }> }> }).contents[0].parts;
      const textPart = parts.find((p) => p.text);
      expect(textPart?.text).toContain("white balance");
      expect(textPart?.text).not.toContain("UV");
    });

    it("sends a UV-preserving prompt when the label contains 'uv'", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "UV light" }],
        outputDir: "/out",
      });

      const [, body] = mockAxios.post.mock.calls[0];
      const parts = (body as { contents: Array<{ parts: Array<{ text?: string }> }> }).contents[0].parts;
      const textPart = parts.find((p) => p.text);
      expect(textPart?.text).toContain("UV fluorescence");
      expect(textPart?.text).not.toContain("well-lit product photo");
    });

    it("uses the UV prompt case-insensitively (e.g. 'uv light')", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "uv light" }],
        outputDir: "/out",
      });

      const [, body] = mockAxios.post.mock.calls[0];
      const parts = (body as { contents: Array<{ parts: Array<{ text?: string }> }> }).contents[0].parts;
      const textPart = parts.find((p) => p.text);
      expect(textPart?.text).toContain("UV");
    });

    it("requests IMAGE in responseModalities", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      });

      const [, body] = mockAxios.post.mock.calls[0];
      const modalities = (
        body as { generationConfig: { responseModalities: string[] } }
      ).generationConfig.responseModalities;
      expect(modalities).toContain("IMAGE");
    });

    it("makes one Gemini call per photo in the batch", async () => {
      mockAxios.post
        .mockResolvedValueOnce(makeGeminiImageResponse())
        .mockResolvedValueOnce(makeGeminiImageResponse());

      await handler({
        photos: [
          { imagePath: "/fake/item1.jpg", label: "front" },
          { imagePath: "/fake/item2.jpg", label: "back" },
        ],
        outputDir: "/out",
      });

      expect(mockAxios.post).toHaveBeenCalledTimes(2);
    });
  });

  // ── Sharp processing ─────────────────────────────────────────────────────────

  describe("handler — Sharp processing", () => {
    it("passes enhanced bytes from Gemini to sharp", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      });

      const sharpCallArg = mockSharp.mock.calls.find(
        (c) => Buffer.isBuffer(c[0]) && (c[0] as Buffer).toString("base64") === FAKE_ENHANCED_BASE64
      );
      expect(sharpCallArg).toBeDefined();
    });

    it("calls composite with a Buffer input (the SVG label)", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      });

      expect(mockComposite).toHaveBeenCalledOnce();
      const compositeArg = mockComposite.mock.calls[0][0] as Array<{ input: unknown }>;
      expect(Buffer.isBuffer(compositeArg[0].input)).toBe(true);
    });

    it("writes output as JPEG with quality 92", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      });

      expect(mockJpeg).toHaveBeenCalledWith({ quality: 92 });
    });

    it("loads Anton font when the font file exists", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      });

      const fontReadCall = (mockFs.readFileSync.mock.calls as Array<[unknown]>).find(([p]) =>
        typeof p === "string" && p.endsWith(".ttf")
      );
      expect(fontReadCall).toBeDefined();
    });

    it("renders label as title case in the SVG overlay", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "glass one — uv light" }],
        outputDir: "/out",
      });

      const svgBuffer = mockComposite.mock.calls[0][0][0].input as Buffer;
      const svgText = svgBuffer.toString("utf8");
      expect(svgText).toContain("Glass One — Uv Light");
    });

    it("uses font size 60 in the SVG overlay", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      });

      const svgBuffer = mockComposite.mock.calls[0][0][0].input as Buffer;
      const svgText = svgBuffer.toString("utf8");
      expect(svgText).toContain('font-size="60"');
    });

    it("continues without font when font file does not exist", async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = (await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      })) as { processed: number };

      expect(result.processed).toBe(1);
    });
  });

  // ── output paths ─────────────────────────────────────────────────────────────

  describe("handler — output", () => {
    it("creates outputDir before writing", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out/processed",
      });

      expect(mockFs.mkdirSync).toHaveBeenCalledWith("/out/processed", { recursive: true });
    });

    it("writes output file with _prepared.jpg suffix in outputDir", async () => {
      await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      });

      const writeCalls = mockFs.writeFileSync.mock.calls as Array<[string, unknown]>;
      expect(writeCalls[0][0]).toBe(path.join("/out", "item_prepared.jpg"));
    });

    it("returns processed count and results array on success", async () => {
      const result = (await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      })) as { processed: number; failed: number; results: Array<{ input: string; output: string; label: string }> };

      expect(result.processed).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.results[0].input).toBe("/fake/item.jpg");
      expect(result.results[0].output).toBe(path.join("/out", "item_prepared.jpg"));
      expect(result.results[0].label).toBe("front");
    });

    it("returns correct counts for a batch of two photos", async () => {
      mockAxios.post
        .mockResolvedValueOnce(makeGeminiImageResponse())
        .mockResolvedValueOnce(makeGeminiImageResponse());

      const result = (await handler({
        photos: [
          { imagePath: "/fake/glass1.jpg", label: "glass one" },
          { imagePath: "/fake/glass2.jpg", label: "glass two" },
        ],
        outputDir: "/out",
      })) as { processed: number; failed: number; results: unknown[] };

      expect(result.processed).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(2);
    });

    it("omits errors key when all photos succeed", async () => {
      const result = (await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      })) as Record<string, unknown>;

      expect(result.errors).toBeUndefined();
    });
  });

  // ── error handling ───────────────────────────────────────────────────────────

  describe("handler — error handling", () => {
    it("records error for a photo when Gemini returns no image part", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: {
          candidates: [{ content: { parts: [{ text: "no image here" }] } }],
        },
      });

      const result = (await handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      })) as { processed: number; failed: number; errors: Array<{ input: string; error: string }> };

      expect(result.processed).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors[0].input).toBe("/fake/item.jpg");
      expect(result.errors[0].error).toContain("GEMINI_IMAGE_MODEL");
    });

    it("continues processing remaining photos after one fails", async () => {
      mockAxios.post
        .mockRejectedValueOnce(new Error("network failure"))
        .mockResolvedValueOnce(makeGeminiImageResponse());

      const result = (await handler({
        photos: [
          { imagePath: "/fake/bad.jpg", label: "front" },
          { imagePath: "/fake/good.jpg", label: "back" },
        ],
        outputDir: "/out",
      })) as { processed: number; failed: number };

      expect(result.processed).toBe(1);
      expect(result.failed).toBe(1);
    });

    it("returns error object on 429 rate limit for that photo", async () => {
      vi.useFakeTimers();
      const rateLimitError = Object.assign(new Error("rate limited") as import("axios").AxiosError, {
        isAxiosError: true,
        response: { status: 429, data: {}, headers: {}, config: {} as never, statusText: "" },
      });
      mockAxios.isAxiosError = vi.fn().mockReturnValue(true) as unknown as typeof mockAxios.isAxiosError;
      mockAxios.post.mockRejectedValue(rateLimitError);

      const resultPromise = handler({
        photos: [{ imagePath: "/fake/item.jpg", label: "front" }],
        outputDir: "/out",
      });
      await vi.runAllTimersAsync();
      const result = (await resultPromise) as {
        failed: number;
        errors: Array<{ error: string }>;
      };

      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toContain("429");
      vi.useRealTimers();
    });
  });
});
