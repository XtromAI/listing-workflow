// Live integration test for the prepare_listing_photo pipeline.
// Tests two capabilities in sequence:
//   1. Gemini image generation — sends a real JPEG, verifies an image is returned
//   2. Sharp label composite — applies a meme-style text label and writes a JPEG
//
// Usage: node scripts/test-prepare-listing-photo.mjs
// Reads GEMINI_API_KEY and GEMINI_IMAGE_MODEL from mcp-server/.env (or the environment).
// Writes test output to /tmp/prepare-listing-photo-test/ and cleans up on success.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
import { dirname, join } from "path";

// Minimal .env loader
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const candidate of [join(root, "mcp-server", ".env"), join(root, ".env")]) {
  try {
    const lines = readFileSync(candidate, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
    break;
  } catch {
    // try next candidate
  }
}

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_IMAGE_MODEL;

if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY not set in mcp-server/.env or environment");
  process.exit(1);
}
if (!model) {
  console.error("ERROR: GEMINI_IMAGE_MODEL not set in mcp-server/.env or environment");
  process.exit(1);
}

console.log(`Model : ${model}`);
console.log(`Key   : ...${apiKey.slice(-6)}\n`);

const TMP_DIR = "/tmp/prepare-listing-photo-test";
mkdirSync(TMP_DIR, { recursive: true });

// ── Helpers ──────────────────────────────────────────────────────────────────

function pass(label, detail = "") {
  console.log(`OK    ${label}${detail ? `  — ${detail}` : ""}`);
}

function fail(label, detail = "") {
  console.error(`FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
}

// Escape XML for SVG text content
function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── 1. Create a test source JPEG using Sharp ──────────────────────────────────

console.log("--- 1. Create test source image ---");
// Resolve sharp from mcp-server/node_modules so the script can run from the repo root
let sharp;
try {
  const mcpRequire = createRequire(join(root, "mcp-server", "package.json"));
  const sharpEntry = mcpRequire.resolve("sharp");
  sharp = (await import(pathToFileURL(sharpEntry).href)).default;
} catch {
  console.error("FAIL  Could not import sharp — run `npm install` in mcp-server/ first");
  process.exit(1);
}

const SOURCE_PATH = join(TMP_DIR, "test-item.jpg");

try {
  // 400×300 gradient image that looks like a real product photo
  await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 3,
      background: { r: 180, g: 160, b: 140 },
    },
  })
    .jpeg({ quality: 85 })
    .toFile(SOURCE_PATH);
  pass("Source JPEG created", SOURCE_PATH);
} catch (err) {
  fail("Could not create test source image", err.message);
  process.exit(1);
}

// ── 2. Call Gemini image generation ──────────────────────────────────────────

console.log("\n--- 2. Gemini image generation ---");

const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
const sourceBase64 = readFileSync(SOURCE_PATH).toString("base64");

let enhancedBytes;
try {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: sourceBase64 } },
            {
              text: "Enhance this item photo for a marketplace listing. Improve brightness, contrast, and white balance. Boost color saturation moderately. Crop and straighten to center the subject. Return a clean, well-lit product photo.",
            },
          ],
        },
      ],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    const msg = data?.error?.message ?? JSON.stringify(data);
    fail(`HTTP ${res.status}`, msg);
    process.exit(1);
  }

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData);

  if (!imagePart) {
    fail("Gemini response contained no image part");
    console.error("     Full response:", JSON.stringify(data, null, 2).slice(0, 500));
    process.exit(1);
  }

  enhancedBytes = Buffer.from(imagePart.inlineData.data, "base64");
  const sizeKb = Math.round(enhancedBytes.length / 1024);
  pass(`Gemini returned image (${sizeKb} KB, mime: ${imagePart.inlineData.mimeType})`);

  const ENHANCED_PATH = join(TMP_DIR, "test-item-enhanced.jpg");
  writeFileSync(ENHANCED_PATH, enhancedBytes);
  pass("Enhanced image saved", ENHANCED_PATH);
} catch (err) {
  fail("Gemini request failed", err.message);
  process.exit(1);
}

// ── 3. Apply Sharp label composite ───────────────────────────────────────────

console.log("\n--- 3. Sharp label composite ---");

const LABEL = "test label";
const OUTPUT_PATH = join(TMP_DIR, "test-item_prepared.jpg");

try {
  const { width = 800, height = 600 } = await sharp(enhancedBytes).metadata();

  // Load Anton font if available (same path logic as the tool)
  const fontPath = join(root, "mcp-server", "fonts", "Anton-Regular.ttf");
  let fontBase64 = null;
  if (existsSync(fontPath)) {
    fontBase64 = readFileSync(fontPath).toString("base64");
  }

  const fontSize = 100;
  const x = 30;
  const y = 30 + fontSize;
  const fontFaceBlock = fontBase64
    ? `<defs><style>@font-face{font-family:'Anton';src:url('data:font/truetype;base64,${fontBase64}')}</style></defs>`
    : "";
  const fontFamily = fontBase64 ? "Anton, Impact, Arial Black, sans-serif" : "Impact, Arial Black, sans-serif";

  const labelSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
${fontFaceBlock}
<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="900"
  fill="none" stroke="black" stroke-width="10" stroke-linejoin="round">${escapeXml(LABEL)}</text>
<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="900"
  fill="white">${escapeXml(LABEL)}</text>
</svg>`
  );

  const finalBuffer = await sharp(enhancedBytes)
    .composite([{ input: labelSvg, top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();

  writeFileSync(OUTPUT_PATH, finalBuffer);

  // Verify the output is a valid JPEG by reading its metadata back
  const outputMeta = await sharp(OUTPUT_PATH).metadata();
  if (outputMeta.format !== "jpeg") {
    fail("Output file is not a valid JPEG", `format: ${outputMeta.format}`);
    process.exit(1);
  }

  const sizeKb = Math.round(finalBuffer.length / 1024);
  const fontNote = fontBase64 ? "Anton font" : "system font fallback";
  pass(`Label composited (${outputMeta.width}×${outputMeta.height}, ${sizeKb} KB, ${fontNote})`);
  pass("Output JPEG valid", OUTPUT_PATH);
} catch (err) {
  fail("Sharp composite failed", err.message);
  process.exit(1);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n--- Summary ---");
console.log(`Output file : ${OUTPUT_PATH}`);
console.log("All tests passed — inspect the output image to verify label rendering.");
console.log("\nLeaving output in /tmp/prepare-listing-photo-test/ for inspection.");
console.log("Run `rm -rf /tmp/prepare-listing-photo-test` to clean up.");
