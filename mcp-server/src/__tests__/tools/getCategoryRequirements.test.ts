import { vi, describe, it, expect, beforeEach } from "vitest";
import axios, { AxiosError } from "axios";
import { handler, definition } from "../../tools/getCategoryRequirements.js";

vi.mock("axios");
vi.mock("../../auth/oauth.js", () => ({
  getAccessToken: vi.fn().mockResolvedValue("mock-token"),
  getEbayBaseUrl: vi.fn().mockReturnValue("https://api.ebay.com"),
}));

const mockAxios = vi.mocked(axios, true);

function makeAxiosError(status: number, data: unknown): AxiosError {
  return Object.assign(new Error("Request failed") as AxiosError, {
    isAxiosError: true,
    response: { status, data, headers: {}, config: {} as never, statusText: "" },
  });
}

function makeAspectsResponse(aspects: unknown[]) {
  return { data: { aspects } };
}

function makeConditionsResponse(policies: unknown[]) {
  return { data: { itemConditionPolicies: policies } };
}

describe("ebay_get_category_requirements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("definition", () => {
    it("has the correct tool name", () => {
      expect(definition.name).toBe("ebay_get_category_requirements");
    });

    it("requires categoryId field", () => {
      expect(definition.inputSchema.required).toContain("categoryId");
    });
  });

  describe("handler", () => {
    it("returns required aspects and valid conditions", async () => {
      mockAxios.get
        .mockResolvedValueOnce(
          makeAspectsResponse([
            {
              localizedAspectName: "Brand",
              aspectConstraint: { aspectRequired: true },
              aspectValues: [{ localizedValue: "Sony" }, { localizedValue: "Bose" }],
            },
            {
              localizedAspectName: "Color",
              aspectConstraint: { aspectRequired: false },
              aspectValues: [],
            },
          ])
        )
        .mockResolvedValueOnce(
          makeConditionsResponse([
            {
              itemConditionRequired: true,
              itemConditions: [
                { conditionId: "1000", conditionDescription: "New" },
                { conditionId: "3000", conditionDescription: "Used" },
              ],
            },
          ])
        );

      const result = await handler({ categoryId: "112529" }) as Record<string, unknown>;

      expect(result.categoryId).toBe("112529");
      expect(result.requiredAspects).toEqual([
        { name: "Brand", suggestedValues: ["Sony", "Bose"] },
      ]);
      expect(result.validConditions).toEqual([
        { conditionDescription: "New", inventoryApiCondition: "NEW" },
        { conditionDescription: "Used", inventoryApiCondition: "USED_EXCELLENT" },
      ]);
      expect(result.conditionRequired).toBe(true);
    });

    it("maps all known condition IDs to their enum equivalents", async () => {
      const conditionIds = [
        ["1000", "NEW"],
        ["1500", "NEW_OTHER"],
        ["1750", "NEW_WITH_DEFECTS"],
        ["2000", "LIKE_NEW"],
        ["2010", "EXCELLENT_REFURBISHED"],
        ["2020", "VERY_GOOD_REFURBISHED"],
        ["2030", "GOOD_REFURBISHED"],
        ["2500", "SELLER_REFURBISHED"],
        ["3000", "USED_EXCELLENT"],
        ["4000", "USED_VERY_GOOD"],
        ["5000", "USED_GOOD"],
        ["6000", "USED_ACCEPTABLE"],
        ["7000", "FOR_PARTS_OR_NOT_WORKING"],
      ];

      mockAxios.get
        .mockResolvedValueOnce(makeAspectsResponse([]))
        .mockResolvedValueOnce(
          makeConditionsResponse([
            {
              itemConditionRequired: false,
              itemConditions: conditionIds.map(([id, desc]) => ({
                conditionId: id,
                conditionDescription: desc,
              })),
            },
          ])
        );

      const result = await handler({ categoryId: "1" }) as { validConditions: Array<{ conditionDescription: string; inventoryApiCondition: string }> };
      for (const [, expectedEnum] of conditionIds) {
        expect(result.validConditions.some((c) => c.inventoryApiCondition === expectedEnum)).toBe(true);
      }
    });

    it("maps unknown condition ID to null", async () => {
      mockAxios.get
        .mockResolvedValueOnce(makeAspectsResponse([]))
        .mockResolvedValueOnce(
          makeConditionsResponse([
            {
              itemConditionRequired: false,
              itemConditions: [{ conditionId: "9999", conditionDescription: "Unknown" }],
            },
          ])
        );

      const result = await handler({ categoryId: "1" }) as { validConditions: Array<{ inventoryApiCondition: string | null }> };
      expect(result.validConditions[0].inventoryApiCondition).toBeNull();
    });

    it("returns conditionRequired false when policy is absent", async () => {
      mockAxios.get
        .mockResolvedValueOnce(makeAspectsResponse([]))
        .mockResolvedValueOnce(makeConditionsResponse([]));

      const result = await handler({ categoryId: "1" }) as { conditionRequired: boolean };
      expect(result.conditionRequired).toBe(false);
    });

    it("throws a formatted error when aspects API fails", async () => {
      // Promise.all starts both API calls concurrently, so both get calls need a mock
      mockAxios.get
        .mockRejectedValueOnce(makeAxiosError(400, { message: "bad request" }))
        .mockResolvedValueOnce(makeConditionsResponse([]));

      await expect(handler({ categoryId: "1" })).rejects.toThrow("Aspects API error:");
    });

    it("throws a formatted error when conditions API fails", async () => {
      mockAxios.get
        .mockResolvedValueOnce(makeAspectsResponse([]))
        .mockRejectedValueOnce(makeAxiosError(403, { message: "forbidden" }));

      await expect(handler({ categoryId: "1" })).rejects.toThrow("Conditions API error:");
    });
  });
});
