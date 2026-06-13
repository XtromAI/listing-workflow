import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const definition = {
  name: "prepare_listing_photo",
  description:
    "Enhance a batch of item photos using Gemini image generation and composite a meme-style text label in the upper-left corner of each. Returns an array of output file paths.",
  inputSchema: {
    type: "object" as const,
    properties: {
      photos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            imagePath: {
              type: "string",
              description: "Absolute path to the source JPEG or PNG",
            },
            label: {
              type: "string",
              description: "Label text to overlay, e.g. 'front', 'base — maker mark', 'UV light'",
            },
          },
          required: ["imagePath", "label"],
        },
        description: "Photos to process — each with an absolute source path and a label string",
      },
      outputDir: {
        type: "string",
        description: "Absolute path to write processed images. Created if it does not exist.",
      },
    },
    required: ["photos", "outputDir"],
  },
};

function toTitleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildLabelSvg(
  label: string,
  width: number,
  height: number,
  fontBase64: string | null
): Buffer {
  const fontSize = 60;
  const x = 30;
  const y = 30 + fontSize;

  const fontFaceBlock = fontBase64
    ? `<defs><style>@font-face{font-family:'Anton';src:url('data:font/truetype;base64,${fontBase64}')}</style></defs>`
    : "";
  const fontFamily = fontBase64
    ? "Anton, Impact, Arial Black, sans-serif"
    : "Impact, Arial Black, sans-serif";

  // Render stroke first (behind), then fill on top — reliable across all SVG renderers
  const displayLabel = escapeXml(toTitleCase(label));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
${fontFaceBlock}
<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="900"
  fill="none" stroke="black" stroke-width="10" stroke-linejoin="round">${displayLabel}</text>
<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="900"
  fill="white">${displayLabel}</text>
</svg>`;

  return Buffer.from(svg);
}

function buildEnhancementPrompt(label: string): string {
  if (/\buv\b/i.test(label)) {
    return "This is a UV light photo taken under ultraviolet illumination. Enhance clarity, sharpness, and contrast while fully preserving the UV fluorescence colors — do not correct the white balance, do not shift colors toward daylight tones, and do not attempt to make the image look like a normal lit photo. Return a clean, sharp UV fluorescence photo.";
  }
  return "Enhance this item photo for a marketplace listing. Improve brightness, contrast, and white balance. Boost color saturation moderately. Do not change the composition, orientation, or position of the item. Do not remove, replace, or significantly alter the background. Do not repose or rerender the item. Preserve all physical details exactly as photographed — including any wear, markings, stickers, or condition details. Return the original photo with only tonal and color corrections applied.";
}

async function enhanceWithGemini(
  imagePath: string,
  label: string,
  apiKey: string,
  model: string
): Promise<Buffer> {
  const mimeType = imagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  const base64Image = fs.readFileSync(imagePath).toString("base64");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType, data: base64Image } },
          { text: buildEnhancementPrompt(label) },
        ],
      },
    ],
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
  };

  let response;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      response = await axios.post(url, body, { timeout: 90000 });
      break;
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const retryable = status === 429 || (status !== undefined && status >= 500);
        if (retryable && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
          continue;
        }
        if (status === 429)
          throw new Error("Gemini rate limit exceeded (429) — try again later");
      }
      throw err;
    }
  }

  if (!response) throw new Error("Gemini request failed after all retries");

  const parts: Array<Record<string, unknown>> =
    response.data?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart) {
    throw new Error(
      "Gemini did not return an image — ensure GEMINI_IMAGE_MODEL is set to an image-generation model (e.g. gemini-3.1-flash-image)"
    );
  }

  const { data } = imagePart.inlineData as { data: string };
  return Buffer.from(data, "base64");
}

export async function handler(args: Record<string, unknown>) {
  const { photos, outputDir } = args as {
    photos: Array<{ imagePath: string; label: string }>;
    outputDir: string;
  };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: "GEMINI_API_KEY not configured" };

  const model = process.env.GEMINI_IMAGE_MODEL;
  if (!model) return { error: "GEMINI_IMAGE_MODEL not configured — add it to your .env file" };

  fs.mkdirSync(outputDir, { recursive: true });

  let fontBase64: string | null = null;
  const fontPath = path.join(__dirname, "../../fonts/Anton-Regular.ttf");
  if (fs.existsSync(fontPath)) {
    fontBase64 = fs.readFileSync(fontPath).toString("base64");
  }

  const results: Array<{ input: string; output: string; label: string }> = [];
  const errors: Array<{ input: string; error: string }> = [];

  for (const photo of photos) {
    try {
      const enhancedBytes = await enhanceWithGemini(photo.imagePath, photo.label, apiKey, model);

      const { width = 1024, height = 1024 } = await sharp(enhancedBytes).metadata();
      const labelSvg = buildLabelSvg(photo.label, width, height, fontBase64);

      const finalBuffer = await sharp(enhancedBytes)
        .composite([{ input: labelSvg, top: 0, left: 0 }])
        .jpeg({ quality: 92 })
        .toBuffer();

      const basename = path.basename(photo.imagePath, path.extname(photo.imagePath));
      const outputPath = path.join(outputDir, `${basename}_prepared.jpg`);
      fs.writeFileSync(outputPath, finalBuffer);

      results.push({ input: photo.imagePath, output: outputPath, label: photo.label });
    } catch (err: unknown) {
      errors.push({
        input: photo.imagePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    processed: results.length,
    failed: errors.length,
    results,
    ...(errors.length > 0 && { errors }),
  };
}
