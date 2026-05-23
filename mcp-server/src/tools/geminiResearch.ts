import fs from "fs";
import axios from "axios";

export const definition = {
  name: "gemini_item_research",
  description:
    "Identify an item by analyzing all provided photos with Gemini 3.5 Flash and live Google Search grounding",
  inputSchema: {
    type: "object" as const,
    properties: {
      imagePaths: {
        type: "array",
        items: { type: "string" },
        description: "Absolute paths to all JPEG or PNG photo files",
      },
      context: {
        type: "string",
        description:
          "Optional context from prior steps — visible text, markings, or user-provided info",
      },
    },
    required: ["imagePaths"],
  },
};

function extractField(text: string, label: string): string {
  const match = text.match(new RegExp(`${label}:\\s*(.+?)(?=\\n[A-Z_]+:|$)`, "s"));
  return match?.[1]?.trim() ?? "";
}

export async function handler(args: Record<string, unknown>) {
  const { imagePaths, context } = args as {
    imagePaths: string[];
    context?: string;
  };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "GEMINI_API_KEY not configured — add it to your .env file" };
  }

  const model = process.env.GEMINI_MODEL;
  if (!model) {
    return { error: "GEMINI_MODEL not configured — add it to your .env file" };
  }

  if (!imagePaths || imagePaths.length === 0) {
    return { error: "imagePaths must contain at least one path" };
  }

  const imageParts = imagePaths.map((p) => ({
    inlineData: {
      mimeType: p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
      data: fs.readFileSync(p).toString("base64"),
    },
  }));

  const contextLine = context ? `Prior research context: ${context}\n\n` : "";
  const prompt =
    `You are an expert antiques and collectibles researcher. Analyze all provided images — they show different angles and details of the same item — and use Google Search to identify it.\n\n` +
    `${contextLine}` +
    `Examine every image carefully. Note any text, markings, logos, model numbers, country of origin, or signatures visible across all photos. Then search Google to corroborate what you observe and find comparable items.\n\n` +
    `Provide your findings in this exact format:\n\n` +
    `ITEM_DESCRIPTION: [One sentence — type, brand/maker, model or pattern name, approximate era]\n` +
    `CATEGORY: [Best marketplace category — e.g. "Vintage Electronics", "Mid-Century Pottery", "Collectible Toys"]\n` +
    `WEB_FINDINGS: [2-4 sentences summarizing what your searches revealed — comparable listings, manufacturer details, production dates, collector value]\n` +
    `SOURCES: [Comma-separated list of the most useful URLs you found, or "none"]\n\n` +
    `Be specific. If you can read any text in any of the images, quote it exactly.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [...imageParts, { text: prompt }] }],
    tools: [{ googleSearch: {} }],
  };

  let response;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      response = await axios.post(url, body);
      break;
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const retryable = status === 429 || (status !== undefined && status >= 500);
        if (retryable && attempt < maxAttempts) {
          const delayMs = 1000 * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        if (status === 429) {
          return { error: "Gemini rate limit exceeded (429) — check your quota at ai.google.dev or try again later" };
        }
      }
      throw err;
    }
  }

  const rawText: string =
    response.data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  return {
    itemDescription: extractField(rawText, "ITEM_DESCRIPTION"),
    suggestedCategory: extractField(rawText, "CATEGORY"),
    webFindings: extractField(rawText, "WEB_FINDINGS"),
    sources: extractField(rawText, "SOURCES")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== "none"),
    rawText,
  };
}
