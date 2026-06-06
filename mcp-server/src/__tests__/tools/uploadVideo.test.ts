import { vi, describe, it, expect, beforeEach } from "vitest";
import axios from "axios";
import * as fs from "fs";
import { handler, definition } from "../../tools/uploadVideo.js";

vi.mock("fs");
vi.mock("axios");
vi.mock("../../auth/oauth.js", () => ({
  getAccessToken: vi.fn().mockResolvedValue("mock-token"),
  getEbayBaseUrl: vi.fn().mockReturnValue("https://api.ebay.com"),
}));

const mockAxios = vi.mocked(axios, true);
const mockFs = vi.mocked(fs);

const FAKE_VIDEO_BUFFER = Buffer.from("fake-video-bytes");
const VIDEO_ID = "v1|123456789|0";

describe("ebay_upload_video", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.readFileSync.mockReturnValue(FAKE_VIDEO_BUFFER);
    process.env.EBAY_ENVIRONMENT = "production";

    // Default: create returns videoId, upload returns 204-ish success
    mockAxios.post
      .mockResolvedValueOnce({ data: { videoId: VIDEO_ID } })
      .mockResolvedValueOnce({ data: {} });
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("ebay_upload_video");
    });

    it("requires videoPath and title", () => {
      expect(definition.inputSchema.required).toContain("videoPath");
      expect(definition.inputSchema.required).toContain("title");
    });

    it("has an optional description field", () => {
      const props = definition.inputSchema.properties as Record<string, unknown>;
      expect(props.description).toBeDefined();
      expect(definition.inputSchema.required).not.toContain("description");
    });
  });

  describe("handler", () => {
    it("returns the videoId from the create response", async () => {
      const result = await handler({ videoPath: "/videos/item.mp4", title: "Test video" }) as Record<string, string>;
      expect(result.videoId).toBe(VIDEO_ID);
    });

    it("calls create endpoint on api.ebay.com in production", async () => {
      await handler({ videoPath: "/videos/item.mp4", title: "Test video" });

      const [createUrl] = mockAxios.post.mock.calls[0];
      expect(createUrl).toBe("https://api.ebay.com/sell/media/v1_beta/video");
    });

    it("calls upload endpoint on apix.ebay.com in production", async () => {
      await handler({ videoPath: "/videos/item.mp4", title: "Test video" });

      const [uploadUrl] = mockAxios.post.mock.calls[1];
      expect(uploadUrl).toBe(`https://apix.ebay.com/sell/media/v1_beta/video/${VIDEO_ID}/upload`);
    });

    it("calls create endpoint on api.sandbox.ebay.com in sandbox", async () => {
      process.env.EBAY_ENVIRONMENT = "sandbox";
      await handler({ videoPath: "/videos/item.mp4", title: "Test video" });

      const [createUrl] = mockAxios.post.mock.calls[0];
      expect(createUrl).toBe("https://api.sandbox.ebay.com/sell/media/v1_beta/video");
    });

    it("calls upload endpoint on apix.sandbox.ebay.com in sandbox", async () => {
      process.env.EBAY_ENVIRONMENT = "sandbox";
      await handler({ videoPath: "/videos/item.mp4", title: "Test video" });

      const [uploadUrl] = mockAxios.post.mock.calls[1];
      expect(uploadUrl).toBe(`https://apix.sandbox.ebay.com/sell/media/v1_beta/video/${VIDEO_ID}/upload`);
    });

    it("sends Authorization header with Bearer token on both calls", async () => {
      await handler({ videoPath: "/videos/item.mp4", title: "Test video" });

      for (const call of mockAxios.post.mock.calls) {
        const config = call[2] as Record<string, unknown>;
        expect((config.headers as Record<string, string>).Authorization).toBe("Bearer mock-token");
      }
    });

    it("sends classification ITEM and title in create body", async () => {
      await handler({ videoPath: "/videos/item.mp4", title: "My listing video" });

      const createBody = mockAxios.post.mock.calls[0][1] as Record<string, unknown>;
      expect(createBody.classification).toEqual(["ITEM"]);
      expect(createBody.title).toBe("My listing video");
      expect(createBody.size).toBe(FAKE_VIDEO_BUFFER.length);
    });

    it("passes description when provided", async () => {
      await handler({ videoPath: "/videos/item.mp4", title: "Title", description: "A nice item" });

      const createBody = mockAxios.post.mock.calls[0][1] as Record<string, unknown>;
      expect(createBody.description).toBe("A nice item");
    });

    it("defaults to empty description when not provided", async () => {
      await handler({ videoPath: "/videos/item.mp4", title: "Title" });

      const createBody = mockAxios.post.mock.calls[0][1] as Record<string, unknown>;
      expect(createBody.description).toBe("");
    });

    it("uses video/mp4 content-type for .mp4 files", async () => {
      await handler({ videoPath: "/videos/item.mp4", title: "Title" });

      const uploadConfig = mockAxios.post.mock.calls[1][2] as Record<string, unknown>;
      expect((uploadConfig.headers as Record<string, string>)["Content-Type"]).toBe("video/mp4");
    });

    it("uses video/quicktime content-type for .mov files", async () => {
      await handler({ videoPath: "/videos/item.mov", title: "Title" });

      const uploadConfig = mockAxios.post.mock.calls[1][2] as Record<string, unknown>;
      expect((uploadConfig.headers as Record<string, string>)["Content-Type"]).toBe("video/quicktime");
    });

    it("throws when create response has no videoId", async () => {
      mockAxios.post.mockReset();
      mockAxios.post.mockResolvedValueOnce({ data: {} });

      await expect(
        handler({ videoPath: "/videos/item.mp4", title: "Title" })
      ).rejects.toThrow("eBay video create failed:");
    });

    it("propagates axios errors from the create step", async () => {
      mockAxios.post.mockReset();
      mockAxios.post.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        handler({ videoPath: "/videos/item.mp4", title: "Title" })
      ).rejects.toThrow("Network error");
    });

    it("propagates axios errors from the upload step", async () => {
      mockAxios.post.mockReset();
      mockAxios.post
        .mockResolvedValueOnce({ data: { videoId: VIDEO_ID } })
        .mockRejectedValueOnce(new Error("Upload failed"));

      await expect(
        handler({ videoPath: "/videos/item.mp4", title: "Title" })
      ).rejects.toThrow("Upload failed");
    });
  });
});
