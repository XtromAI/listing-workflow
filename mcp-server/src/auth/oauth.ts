import axios from "axios";

export function getEbayBaseUrl(): string {
  return process.env.EBAY_ENVIRONMENT === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const { EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REFRESH_TOKEN } = process.env;
  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");
  const baseUrl =
    process.env.EBAY_ENVIRONMENT === "sandbox"
      ? "https://api.sandbox.ebay.com"
      : "https://api.ebay.com";

  const response = await axios.post(
    `${baseUrl}/identity/v1/oauth2/token`,
    `grant_type=refresh_token&refresh_token=${EBAY_REFRESH_TOKEN}`,
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  cachedToken = response.data.access_token;
  tokenExpiresAt = Date.now() + response.data.expires_in * 1000;
  return cachedToken!;
}
