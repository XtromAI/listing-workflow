import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import axios from "axios";

vi.mock("axios");

const mockAxios = vi.mocked(axios, true);

describe("oauth", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.EBAY_CLIENT_ID = "test-client-id";
    process.env.EBAY_CLIENT_SECRET = "test-client-secret";
    process.env.EBAY_REFRESH_TOKEN = "test-refresh-token";
    delete process.env.EBAY_ENVIRONMENT;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  describe("getEbayBaseUrl", () => {
    it("returns production URL by default", async () => {
      const { getEbayBaseUrl } = await import("../../auth/oauth.js");
      expect(getEbayBaseUrl()).toBe("https://api.ebay.com");
    });

    it("returns sandbox URL when EBAY_ENVIRONMENT is sandbox", async () => {
      process.env.EBAY_ENVIRONMENT = "sandbox";
      const { getEbayBaseUrl } = await import("../../auth/oauth.js");
      expect(getEbayBaseUrl()).toBe("https://api.sandbox.ebay.com");
    });
  });

  describe("getAccessToken", () => {
    it("fetches a new token using client credentials and refresh token", async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { access_token: "fresh-token", expires_in: 7200 },
      });

      const { getAccessToken } = await import("../../auth/oauth.js");
      const token = await getAccessToken();

      expect(token).toBe("fresh-token");
      expect(mockAxios.post).toHaveBeenCalledTimes(1);

      const [url, body, config] = mockAxios.post.mock.calls[0];
      expect(url).toBe("https://api.ebay.com/identity/v1/oauth2/token");
      expect(body).toContain("grant_type=refresh_token");
      expect(body).toContain("test-refresh-token");

      const expectedCreds = Buffer.from("test-client-id:test-client-secret").toString("base64");
      expect((config as Record<string, unknown>).headers).toMatchObject({
        Authorization: `Basic ${expectedCreds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      });
    });

    it("uses sandbox URL when EBAY_ENVIRONMENT is sandbox", async () => {
      process.env.EBAY_ENVIRONMENT = "sandbox";
      mockAxios.post.mockResolvedValueOnce({
        data: { access_token: "sandbox-token", expires_in: 7200 },
      });

      const { getAccessToken } = await import("../../auth/oauth.js");
      await getAccessToken();

      expect(mockAxios.post.mock.calls[0][0]).toBe(
        "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
      );
    });

    it("returns cached token on subsequent calls within expiry window", async () => {
      mockAxios.post.mockResolvedValue({
        data: { access_token: "cached-token", expires_in: 7200 },
      });

      const { getAccessToken } = await import("../../auth/oauth.js");
      const token1 = await getAccessToken();
      const token2 = await getAccessToken();

      expect(token1).toBe("cached-token");
      expect(token2).toBe("cached-token");
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
    });

    it("refreshes token after expiry (60s buffer)", async () => {
      const nowSpy = vi.spyOn(Date, "now");
      // First call at t=0
      nowSpy.mockReturnValue(0);
      mockAxios.post.mockResolvedValueOnce({
        data: { access_token: "first-token", expires_in: 100 },
      });

      const { getAccessToken } = await import("../../auth/oauth.js");
      const token1 = await getAccessToken();
      expect(token1).toBe("first-token");

      // Advance past expiry minus 60s buffer (expires_in=100s, buffer=60s → expires at 40_000ms)
      nowSpy.mockReturnValue(41_000);
      mockAxios.post.mockResolvedValueOnce({
        data: { access_token: "refreshed-token", expires_in: 7200 },
      });

      const token2 = await getAccessToken();
      expect(token2).toBe("refreshed-token");
      expect(mockAxios.post).toHaveBeenCalledTimes(2);

      nowSpy.mockRestore();
    });

    it("propagates axios errors", async () => {
      mockAxios.post.mockRejectedValueOnce(new Error("Network error"));

      const { getAccessToken } = await import("../../auth/oauth.js");
      await expect(getAccessToken()).rejects.toThrow("Network error");
    });
  });
});
