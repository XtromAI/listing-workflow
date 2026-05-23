import { vi, describe, it, expect, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import { handler, definition } from "../../../tools/etsy/createDraftListing.js";

vi.mock("axios");
vi.mock("../../../auth/etsy-oauth.js", () => ({
  getEtsyAccessToken: vi.fn().mockResolvedValue("mock-etsy-token"),
  ETSY_BASE_URL: "https://openapi.etsy.com/v3",
}));

const mockAxios = vi.mocked(axios, true);

function makeAxiosError(status: number, data: unknown): AxiosError {
  return Object.assign(new Error("Request failed") as AxiosError, {
    isAxiosError: true,
    response: { status, data, headers: {}, config: {} as never, statusText: "" },
  });
}

const BASE_ARGS = {
  title: "Vintage Denim Jacket",
  description: "A beautiful vintage denim jacket from the 1990s.",
  price: 45.00,
  taxonomyId: 68887691,
  whoMade: "someone_else",
  whenMade: "1990s",
};

describe("etsy_create_draft_listing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ETSY_SHOP_ID = "12345678";
    process.env.ETSY_API_KEY = "test-etsy-api-key";
    process.env.ETSY_SHIPPING_PROFILE_ID = "111";
    process.env.ETSY_RETURN_POLICY_ID = "222";
    mockAxios.post.mockResolvedValue({ data: { listing_id: 999001 } });
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("etsy_create_draft_listing");
    });

    it("requires title, description, price, taxonomyId, whoMade, and whenMade", () => {
      const required = definition.inputSchema.required;
      expect(required).toContain("title");
      expect(required).toContain("description");
      expect(required).toContain("price");
      expect(required).toContain("taxonomyId");
      expect(required).toContain("whoMade");
      expect(required).toContain("whenMade");
    });
  });

  describe("handler", () => {
    it("returns listingId from API response", async () => {
      const result = await handler(BASE_ARGS) as Record<string, number>;
      expect(result.listingId).toBe(999001);
    });

    it("posts to the shop listings endpoint", async () => {
      await handler(BASE_ARGS);
      const [url] = mockAxios.post.mock.calls[0];
      expect(url).toContain("/application/shops/12345678/listings");
    });

    it("sets state to draft", async () => {
      await handler(BASE_ARGS);
      const [, body] = mockAxios.post.mock.calls[0];
      expect((body as Record<string, unknown>).state).toBe("draft");
    });

    it("sends Authorization and x-api-key headers", async () => {
      await handler(BASE_ARGS);
      const [, , config] = mockAxios.post.mock.calls[0];
      expect((config as Record<string, unknown>).headers).toMatchObject({
        Authorization: "Bearer mock-etsy-token",
        "x-api-key": "test-etsy-api-key",
      });
    });

    it("defaults quantity to 1 and isSupply to false", async () => {
      await handler(BASE_ARGS);
      const [, body] = mockAxios.post.mock.calls[0];
      expect((body as Record<string, unknown>).quantity).toBe(1);
      expect((body as Record<string, unknown>).is_supply).toBe(false);
    });

    it("uses provided quantity and isSupply", async () => {
      await handler({ ...BASE_ARGS, quantity: 5, isSupply: true });
      const [, body] = mockAxios.post.mock.calls[0];
      expect((body as Record<string, unknown>).quantity).toBe(5);
      expect((body as Record<string, unknown>).is_supply).toBe(true);
    });

    it("uses shippingProfileId from args when provided", async () => {
      await handler({ ...BASE_ARGS, shippingProfileId: 999 });
      const [, body] = mockAxios.post.mock.calls[0];
      expect((body as Record<string, unknown>).shipping_profile_id).toBe(999);
    });

    it("falls back to ETSY_SHIPPING_PROFILE_ID env var when shippingProfileId not in args", async () => {
      await handler(BASE_ARGS);
      const [, body] = mockAxios.post.mock.calls[0];
      expect((body as Record<string, unknown>).shipping_profile_id).toBe(111);
    });

    it("uses returnPolicyId from args when provided", async () => {
      await handler({ ...BASE_ARGS, returnPolicyId: 888 });
      const [, body] = mockAxios.post.mock.calls[0];
      expect((body as Record<string, unknown>).return_policy_id).toBe(888);
    });

    it("falls back to ETSY_RETURN_POLICY_ID env var when returnPolicyId not in args", async () => {
      await handler(BASE_ARGS);
      const [, body] = mockAxios.post.mock.calls[0];
      expect((body as Record<string, unknown>).return_policy_id).toBe(222);
    });

    it("includes tags when provided", async () => {
      await handler({ ...BASE_ARGS, tags: ["vintage", "denim", "90s"] });
      const [, body] = mockAxios.post.mock.calls[0];
      expect((body as Record<string, unknown>).tags).toEqual(["vintage", "denim", "90s"]);
    });

    it("omits tags field when not provided", async () => {
      await handler(BASE_ARGS);
      const [, body] = mockAxios.post.mock.calls[0];
      expect(body).not.toHaveProperty("tags");
    });

    it("includes materials when provided", async () => {
      await handler({ ...BASE_ARGS, materials: ["denim", "cotton"] });
      const [, body] = mockAxios.post.mock.calls[0];
      expect((body as Record<string, unknown>).materials).toEqual(["denim", "cotton"]);
    });

    it("omits materials field when not provided", async () => {
      await handler(BASE_ARGS);
      const [, body] = mockAxios.post.mock.calls[0];
      expect(body).not.toHaveProperty("materials");
    });

    it("uses snake_case field names for Etsy API", async () => {
      await handler(BASE_ARGS);
      const [, body] = mockAxios.post.mock.calls[0];
      const b = body as Record<string, unknown>;
      expect(b).toHaveProperty("taxonomy_id", 68887691);
      expect(b).toHaveProperty("who_made", "someone_else");
      expect(b).toHaveProperty("when_made", "1990s");
    });

    it("throws formatted Etsy Listings API error on AxiosError with response", async () => {
      mockAxios.post.mockRejectedValueOnce(makeAxiosError(400, { error: "Invalid taxonomy ID" }));
      await expect(handler(BASE_ARGS)).rejects.toThrow("Etsy Listings API 400:");
    });

    it("re-throws non-axios errors unchanged", async () => {
      mockAxios.post.mockRejectedValueOnce(new Error("network timeout"));
      await expect(handler(BASE_ARGS)).rejects.toThrow("network timeout");
    });
  });
});
