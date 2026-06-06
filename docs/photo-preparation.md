# Photo Preparation

The `prepare_listing_photo` tool automates the manual process of enhancing item photos and labeling them before listing. It replaces the hand-editing steps (saturation, contrast, white balance, crop, alignment, corner labels) with an AI-driven pipeline that runs inside the existing listing workflow.

---

## When it runs

During **Phase 1, Step 6** — after research is complete and the user approves saving a draft — Claude asks:

> "Would you like me to enhance the photos using Gemini and add labels to each one? Or have the photos already been processed?"

If you say **yes**, the tool runs on all photos before they are archived. If you say **no** (because you already processed them manually), the step is skipped entirely and your photos are used as-is.

---

## What the tool does, step by step

```
Inbox/photo1.jpg  ──►  Gemini enhancement  ──►  Sharp label composite  ──►  drafts/[item]/processed/photo1_prepared.jpg
                                                                               drafts/[item]/originals/photo1.jpg (untouched)
```

### 1. Claude generates labels

Before calling the tool, Claude reviews its own visual assessment from Step 2 and assigns a short label to each photo based on what it observed — for example:

| Photo | Generated label |
|---|---|
| Close-up of base | `"base — maker mark"` |
| Item facing forward | `"front"` |
| Item from the back | `"back"` |
| Shot under UV light | `"UV light"` |
| Close-up of handle | `"detail — handle"` |

You never provide these manually. Claude derives them from what it already knows about each photo.

### 2. Originals are moved first

Every photo from `Inbox/` is moved to `drafts/[item-title]/originals/`. These files are never modified — they are preserved as a permanent reference copy regardless of what happens during processing.

### 3. Gemini enhances each photo

Each original is sent to the **Gemini image generation API** (`gemini-3.1-flash-image` — Google's "Nano Banana 2" model). The request includes the full image as base64-encoded inline data alongside a prompt instructing the model to:

- Correct white balance and brightness
- Boost contrast and color saturation moderately
- Crop and straighten to center the subject
- Return a clean, well-lit product photo

Gemini processes the image and returns a new version as base64-encoded JPEG bytes. The original is not modified.

### 4. Sharp composites the text label

The enhanced image bytes are passed to **Sharp**, a native Node.js image processing library. Sharp renders an SVG overlay and composites it onto the image:

**SVG construction:** An SVG the same dimensions as the enhanced image is built in memory. The label text is rendered twice in the upper-left corner:
1. First pass — black stroke (10px, round-joined) — rendered underneath
2. Second pass — white fill — rendered on top

This double-render technique produces the classic meme-style white text with a black border that reads clearly on any background color, and is compatible with all SVG renderers regardless of CSS support.

**Font:** The Anton typeface (Google Fonts, SIL Open Font License) is bundled at `mcp-server/fonts/Anton-Regular.ttf` and embedded into the SVG as a base64 `@font-face` declaration. Anton is a condensed, heavy display font — the standard choice for bold overlay labels. If the font file is absent, the SVG falls back to `Impact, Arial Black, sans-serif`.

**Font size:** 100px. At typical listing photo resolutions (1000–4000px wide) this produces a label large enough to read in thumbnail view without overwhelming the subject. Adjustable in the tool source if needed.

### 5. Output is written to `processed/`

The final JPEG (quality 92) is written to `drafts/[item-title]/processed/[filename]_prepared.jpg`.

The tool processes photos sequentially. If an individual photo fails (Gemini error, network timeout, etc.), that photo is recorded in an `errors` array and processing continues — the batch does not stop.

### 6. Listing uploads use the processed photos

In Phase 2 (Steps 11), when Claude uploads photos to eBay and Etsy, it reads from `processed/`. If `processed/` is empty (processing was skipped or all photos failed), it falls back to `originals/`.

---

## Folder structure after Phase 1

```
drafts/
  vintage-pyrex-bowl/
    originals/
      DSC001.jpg          ← raw photo, untouched
      DSC002.jpg
      DSC003.jpg
    processed/
      DSC001_prepared.jpg ← Gemini-enhanced + "front" label
      DSC002_prepared.jpg ← Gemini-enhanced + "base — maker mark" label
      DSC003_prepared.jpg ← Gemini-enhanced + "UV light" label
    item-log.md
```

---

## Technologies

| Component | Technology | Purpose |
|---|---|---|
| Image enhancement | [Gemini image generation API](https://ai.google.dev/gemini-api/docs/image-generation) (`gemini-3.1-flash-image`) | AI-driven photo enhancement — brightness, contrast, saturation, crop, alignment |
| Image processing | [Sharp](https://sharp.pixelplumbing.com/) (libvips) | Read/write JPEG/PNG, SVG compositing, final JPEG encoding |
| Label rendering | SVG + Anton font | Meme-style white text with black stroke, composited at the pixel level |
| Font | [Anton](https://fonts.google.com/specimen/Anton) (bundled TTF) | Condensed heavy display font, SIL Open Font License |
| Label generation | Claude (Step 2 visual assessment) | Claude reads its own photo notes to name each shot — no user input needed |

### Why Gemini for enhancement rather than Sharp filters alone?

Sharp can apply fixed adjustments (brightness +10%, saturation ×1.3, etc.), but it has no understanding of the image content. Gemini understands what a "well-lit product photo" looks like and applies corrections contextually — it knows to boost a dark subject differently than an already bright one, and it can straighten and crop to the subject without being given explicit bounding boxes.

### Why Sharp for the label rather than asking Gemini to add it?

Text positioning in generative image models is unreliable — the label might shift, wrap, or vary in size between calls. Sharp compositing an SVG is deterministic: the label is always in the upper-left corner at exactly the specified size, with consistent font rendering, on every run.

---

## Configuration

Two environment variables are required:

| Variable | Example value | Where to set |
|---|---|---|
| `GEMINI_API_KEY` | `AIzaSy...` | `mcp-server/.env` and Claude Desktop config `env` block |
| `GEMINI_IMAGE_MODEL` | `gemini-3.1-flash-image` | `mcp-server/.env` and Claude Desktop config `env` block |

`GEMINI_IMAGE_MODEL` is separate from `GEMINI_MODEL` (the text/research model). This lets you use a lightweight model for research and a higher-quality image model for photo processing, or upgrade one without touching the other.

To use the higher-quality model for challenging photos, change `GEMINI_IMAGE_MODEL` to `gemini-3-pro-image`. Cost per image increases from ~$0.045 to ~$0.134.

---

## Testing

**Unit tests** (no real API calls — all mocked):

```bash
cd mcp-server
npx vitest run src/__tests__/tools/prepareListingPhoto.test.ts
```

**Live integration test** (calls Gemini, writes a real JPEG to `/tmp/`):

```bash
# from repo root
node scripts/test-prepare-listing-photo.mjs
```

The integration test:
1. Creates a 400×300 test JPEG using Sharp
2. Sends it to Gemini and verifies an image is returned
3. Composites the Anton label onto the enhanced image
4. Validates the output is a readable JPEG
5. Leaves the output in `/tmp/prepare-listing-photo-test/` for visual inspection

---

## Troubleshooting

**"GEMINI_IMAGE_MODEL not configured"**
Add `GEMINI_IMAGE_MODEL=gemini-3.1-flash-image` to `mcp-server/.env` and to the `env` block in your Claude Desktop config. Restart Claude Desktop.

**"Gemini did not return an image"**
The model name is wrong or your API key does not have access to image generation models. Verify `GEMINI_IMAGE_MODEL` is set to an image-generation model (e.g. `gemini-3.1-flash-image`), not a text-only model like `gemini-3.1-flash-lite`.

**Label text is not Anton / looks like a generic font**
The bundled font file is missing from `mcp-server/fonts/Anton-Regular.ttf`. Re-download it:
```bash
curl -sL "https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf" \
  -o mcp-server/fonts/Anton-Regular.ttf
```
Then rebuild: `cd mcp-server && npm run build`.

**Photos failed but originals are safe**
The originals are moved to `drafts/[item]/originals/` before processing begins. If the tool reports failed photos, your originals are preserved untouched in that folder.
