import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import axios from "axios";

vi.mock("axios");

const mockAxios = vi.mocked(axios, true);

describe("etsy-oauth", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.ETSY_CLIENT_ID = "test-etsy-client";
    process.env.ETSY_REFRESH_TOKEN = "test-etsy-refresh";
  });

  afterEach(() => {
    process.env = { ...envBackup };
    vi.restoreAllMocks();
  });

  describe("ETSY_BASE_URL", () => {
    it("exports the correct base URL", async () => {
      const { ETSY_BASE_URL } = await import("../../auth/etsy-oauth.js");
      expect(ETSY_BASE_URL).toBe("https://openapi.etsy.com/v3");
    });
  });

  describe("getEtsyAccessToken", () => {
    it("throws when ETSY_CLIENT_ID is missing", async () => {
      delete process.env.ETSY_CLIENT_ID;
      const { getEtsyAccessToken } = await import("../../auth/etsy-oauth.js");
      await expect(getEtsyAccessToken()).rejects.toThrow(
        "Missing ETSY_CLIENT_ID or ETSY_REFRESH_TOKEN"
      );
    });

    it("throws when ETSY_REFRESH_TOKEN is missing", async () => {
      delete process.env.ETSY_REFRESH_TOKEN;
      const { getEtsyAccessToken } = await import("../../auth/etsy-oauth.js");
      await expect(getEtsyAccessToken()).rejects.toThrow(
        "Missing ETSY_CLIENT_ID or ETSY_REFRESH_TOKEN"
      );
    });

    it("fetches a token using client_id and refresh_token", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { access_token: "etsy-token", expires_in: 3600, refresh_token: "test-etsy-refresh" },
      });

      const { getEtsyAccessToken } = await import("../../auth/etsy-oauth.js");
      const token = await getEtsyAccessToken();

      expect(token).toBe("etsy-token");
      expect(mockAxios.post).toHaveBeenCalledOnce();

      const [url, body] = mockAxios.post.mock.calls[0];
      expect(url).toBe("https://api.etsy.com/v3/public/oauth/token");

      const params = body as URLSearchParams;
      expect(params.get("grant_type")).toBe("refresh_token");
      expect(params.get("client_id")).toBe("test-etsy-client");
      expect(params.get("refresh_token")).toBe("test-etsy-refresh");
    });

    it("returns cached token without re-fetching within expiry", async () => {
      mockAxios.post.mockResolvedValue({
        data: { access_token: "cached-etsy-token", expires_in: 3600, refresh_token: "test-etsy-refresh" },
      });

      const { getEtsyAccessToken } = await import("../../auth/etsy-oauth.js");
      const t1 = await getEtsyAccessToken();
      const t2 = await getEtsyAccessToken();

      expect(t1).toBe("cached-etsy-token");
      expect(t2).toBe("cached-etsy-token");
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
    });

    it("logs and rotates refresh token when Etsy returns a new one", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockAxios.post.mockResolvedValueOnce({
        data: {
          access_token: "etsy-token",
          expires_in: 3600,
          refresh_token: "new-rotated-refresh-token",
        },
      });

      const { getEtsyAccessToken } = await import("../../auth/etsy-oauth.js");
      await getEtsyAccessToken();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("new-rotated-refresh-token")
      );

      stderrSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it("uses the in-memory rotated refresh token on the next call", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      // First call: Etsy rotates the token
      mockAxios.post.mockResolvedValueOnce({
        data: {
          access_token: "first-etsy-token",
          expires_in: 1, // expire immediately
          refresh_token: "rotated-token",
        },
      });

      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);
      const { getEtsyAccessToken } = await import("../../auth/etsy-oauth.js");
      await getEtsyAccessToken();

      // Advance past expiry
      nowSpy.mockReturnValue(62_000);

      mockAxios.post.mockResolvedValueOnce({
        data: {
          access_token: "second-etsy-token",
          expires_in: 3600,
          refresh_token: "rotated-token",
        },
      });

      await getEtsyAccessToken();

      const secondCallBody = mockAxios.post.mock.calls[1][1] as URLSearchParams;
      expect(secondCallBody.get("refresh_token")).toBe("rotated-token");

      nowSpy.mockRestore();
    });

    it("propagates axios errors", async () => {
      mockAxios.post.mockRejectedValueOnce(new Error("Etsy network error"));
      const { getEtsyAccessToken } = await import("../../auth/etsy-oauth.js");
      await expect(getEtsyAccessToken()).rejects.toThrow("Etsy network error");
    });
  });
});
