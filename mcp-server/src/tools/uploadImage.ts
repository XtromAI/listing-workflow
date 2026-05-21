import fs from "fs";
import path from "path";
import axios from "axios";
import { getAccessToken } from "../auth/oauth.js";

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
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";

  const imageBuffer = fs.readFileSync(imagePath);
  const token = await getAccessToken();

  const baseUrl = process.env.EBAY_ENVIRONMENT === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${token}</eBayAuthToken>
  </RequesterCredentials>
  <PictureSet>Supersize</PictureSet>
</UploadSiteHostedPicturesRequest>`;

  const form = new FormData();
  form.append("xml payload", new Blob([xml], { type: "text/xml" }));
  form.append("image", new Blob([imageBuffer], { type: mimeType }), path.basename(imagePath));

  const response = await axios.post<string>(
    `${baseUrl}/ws/api.dll`,
    form,
    {
      headers: {
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "X-EBAY-API-CALL-NAME": "UploadSiteHostedPictures",
        "X-EBAY-API-APP-NAME": process.env.EBAY_CLIENT_ID!,
      },
    }
  );

  const match = response.data.match(/<FullURL>(.*?)<\/FullURL>/);
  if (!match) {
    throw new Error(`EPS upload failed: ${response.data}`);
  }

  return { imageUrl: match[1] };
}
