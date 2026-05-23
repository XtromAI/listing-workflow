import fs from "fs";
import path from "path";
import axios, { AxiosError } from "axios";
import { getEtsyAccessToken, ETSY_BASE_URL } from "../../auth/etsy-oauth.js";

export const definition = {
  name: "etsy_upload_listing_image",
  description:
    "Upload a local image file to an Etsy listing. Call after etsy_create_draft_listing. Up to 10 images per listing; rank 1 is the main image.",
  inputSchema: {
    type: "object" as const,
    properties: {
      listingId: { type: "number", description: "Listing ID from etsy_create_draft_listing" },
      imagePath: { type: "string", description: "Absolute path to JPEG or PNG file" },
      rank: {
        type: "number",
        description: "Display order position (1 = main image, default 1)",
      },
    },
    required: ["listingId", "imagePath"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const listingId = args.listingId as number;
  const imagePath = args.imagePath as string;
  const rank = (args.rank as number | undefined) ?? 1;

  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
  const imageBuffer = fs.readFileSync(imagePath);

  const token = await getEtsyAccessToken();
  const shopId = process.env.ETSY_SHOP_ID!;

  const form = new FormData();
  form.append("image", new Blob([imageBuffer], { type: mimeType }), path.basename(imagePath));
  form.append("rank", String(rank));
  form.append("overwrite", "true");
  form.append("is_watermarked", "false");
  form.append("alt_text", "");

  let response;
  try {
    response = await axios.post(
      `${ETSY_BASE_URL}/application/shops/${shopId}/listings/${listingId}/images`,
      form,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-api-key": process.env.ETSY_API_KEY!,
        },
      }
    );
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response) {
      throw new Error(
        `Etsy Images API ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`
      );
    }
    throw err;
  }

  return {
    listingImageId: response.data.listing_image_id as number,
    url: response.data.url_fullxfull as string,
    rank: response.data.rank as number,
  };
}
