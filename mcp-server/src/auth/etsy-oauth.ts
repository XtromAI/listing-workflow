import axios from "axios";

export const ETSY_BASE_URL = "https://openapi.etsy.com/v3";

let cachedToken: string | null = null;
let tokenExpiresAt = 0;
let currentRefreshToken: string | null = null;

export async function getEtsyAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const { ETSY_CLIENT_ID, ETSY_REFRESH_TOKEN } = process.env;
  const refreshToken = currentRefreshToken ?? ETSY_REFRESH_TOKEN;

  if (!ETSY_CLIENT_ID || !refreshToken) {
    throw new Error("Missing ETSY_CLIENT_ID or ETSY_REFRESH_TOKEN environment variables");
  }

  const response = await axios.post(
    "https://api.etsy.com/v3/public/oauth/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ETSY_CLIENT_ID,
      refresh_token: refreshToken,
    }),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );

  cachedToken = response.data.access_token;
  tokenExpiresAt = Date.now() + response.data.expires_in * 1000;

  // Etsy rotates refresh tokens on each use — keep the new one in memory
  if (response.data.refresh_token && response.data.refresh_token !== refreshToken) {
    currentRefreshToken = response.data.refresh_token;
    console.error(
      `[etsy-auth] Refresh token rotated. Update ETSY_REFRESH_TOKEN in your .env to: ${currentRefreshToken}`
    );
  }

  return cachedToken!;
}
