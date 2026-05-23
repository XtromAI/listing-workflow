// Live connectivity test for the Gemini API.
// Tests three capabilities in sequence: basic text, Google Search grounding, and image input.
// Usage: node scripts/test-gemini.mjs
// Reads GEMINI_API_KEY and GEMINI_MODEL from mcp-server/.env (or the environment).

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Minimal .env loader — checks mcp-server/.env relative to repo root
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
const model = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";

if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY not set in mcp-server/.env or environment");
  process.exit(1);
}

console.log(`Model : ${model}`);
console.log(`Key   : ...${apiKey.slice(-6)}\n`);

const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

async function post(label, body) {
  console.log(`--- ${label} ---`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`FAIL  HTTP ${res.status}`);
      const msg = data?.error?.message ?? JSON.stringify(data);
      console.error(`      ${msg}\n`);
      return false;
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no text)";
    console.log(`OK    ${text.trim().slice(0, 120)}\n`);
    return true;
  } catch (err) {
    console.error(`FAIL  network error: ${err.message}\n`);
    return false;
  }
}

// 1. Basic text — confirms key and model are valid
await post("1. Basic text", {
  contents: [{ parts: [{ text: "Reply with exactly: GEMINI_OK" }] }],
});

// 2. Google Search grounding — confirms grounding is available on this account tier
await post("2. Google Search grounding", {
  contents: [{ parts: [{ text: "What is the current price of a first-class US postage stamp? Reply in one sentence." }] }],
  tools: [{ googleSearch: {} }],
});

// 3. Image input — a 1×1 red PNG inline; confirms multimodal input works
// This is a known-good minimal PNG (1×1 red pixel, 68 bytes)
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==";

await post("3. Image input (1×1 inline PNG)", {
  contents: [
    {
      parts: [
        { inlineData: { mimeType: "image/png", data: TINY_PNG_BASE64 } },
        { text: "This image is a single pixel. What color is it? Reply in one sentence." },
      ],
    },
  ],
});
