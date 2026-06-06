import fs from "fs";
import path from "path";
import axios from "axios";
import { getAccessToken } from "../auth/oauth.js";

export const definition = {
  name: "ebay_upload_video",
  description:
    "Upload a local video file to eBay via the Media API. Returns a videoId that can be referenced in a listing. Two-step process: creates a video resource then uploads the binary content.",
  inputSchema: {
    type: "object" as const,
    properties: {
      videoPath: {
        type: "string",
        description: "Absolute path to an MP4 or MOV video file",
      },
      title: {
        type: "string",
        description: "Title for the video (max 80 characters)",
      },
      description: {
        type: "string",
        description: "Optional description of the video",
      },
    },
    required: ["videoPath", "title"],
  },
};

export async function handler(args: Record<string, unknown>) {
  const videoPath = args.videoPath as string;
  const title = args.title as string;
  const description = (args.description as string | undefined) ?? "";

  const ext = path.extname(videoPath).toLowerCase();
  const mimeType = ext === ".mov" ? "video/quicktime" : "video/mp4";

  const videoBuffer = fs.readFileSync(videoPath);
  const token = await getAccessToken();

  const isSandbox = process.env.EBAY_ENVIRONMENT === "sandbox";
  const apiBaseUrl = isSandbox
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
  const uploadBaseUrl = isSandbox
    ? "https://apix.sandbox.ebay.com"
    : "https://apix.ebay.com";

  // Step 1: create the video resource to get a videoId
  const createResponse = await axios.post(
    `${apiBaseUrl}/sell/media/v1_beta/video`,
    {
      classification: ["ITEM"],
      description,
      size: videoBuffer.length,
      title,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  const videoId: string = createResponse.data.videoId;
  if (!videoId) {
    throw new Error(
      `eBay video create failed: ${JSON.stringify(createResponse.data)}`
    );
  }

  // Step 2: stream the binary content to the upload endpoint
  await axios.post(
    `${uploadBaseUrl}/sell/media/v1_beta/video/${videoId}/upload`,
    videoBuffer,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": mimeType,
        "Content-Length": String(videoBuffer.length),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );

  return { videoId };
}
