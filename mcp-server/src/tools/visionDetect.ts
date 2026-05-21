import fs from "fs";
import axios from "axios";

export const definition = {
  name: "google_vision_web_detection",
  description: "Identify an item using Google Cloud Vision web detection",
  inputSchema: {
    type: "object" as const,
    properties: {
      imagePath: { type: "string", description: "Absolute path to JPEG or PNG file" },
    },
    required: ["imagePath"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const imagePath = args.imagePath as string;
  const imageData = fs.readFileSync(imagePath).toString("base64");
  const apiKey = process.env.GOOGLE_VISION_API_KEY;

  const response = await axios.post(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      requests: [
        {
          image: { content: imageData },
          features: [{ type: "WEB_DETECTION" }],
        },
      ],
    }
  );

  const web = (response.data.responses[0]?.webDetection ?? {}) as {
    bestGuessLabels?: Array<{ label: string }>;
    webEntities?: Array<{ description: string; score: number }>;
    pagesWithMatchingImages?: Array<{ url: string; pageTitle?: string }>;
  };

  return {
    bestGuessLabels: (web.bestGuessLabels ?? []).map((l) => l.label),
    webEntities: (web.webEntities ?? []).map((e) => ({
      description: e.description,
      score: e.score,
    })),
    pagesWithMatchingImages: (web.pagesWithMatchingImages ?? []).map((p) => ({
      url: p.url,
      pageTitle: p.pageTitle ?? null,
    })),
  };
}
