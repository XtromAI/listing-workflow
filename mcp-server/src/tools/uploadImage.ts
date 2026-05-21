import fs from "fs";
import path from "path";
import axios from "axios";
import { getAccessToken, getEbayBaseUrl } from "../auth/oauth";

export const definition = {
  name: "ebay_upload_image",
  description: "Upload a local image file to eBay hosting and return the URL",
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
  const ext = path.extname(imagePath).toLowerCase();
  const imageType = ext === ".png" ? "PNG" : "JPEG";

  const imageData = fs.readFileSync(imagePath).toString("base64");
  const token = await getAccessToken();

  const response = await axios.post(
    `${getEbayBaseUrl()}/sell/media/v1/image`,
    { imageType, imageData },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return { imageUrl: response.data.imageUrl as string };
}
