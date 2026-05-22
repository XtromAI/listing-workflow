/**
 * One-time script to obtain an Etsy refresh token via OAuth 2.0 + PKCE.
 *
 * Usage:
 *   1. Paste your Etsy app Keystring into CLIENT_ID below.
 *   2. Make sure http://localhost:3003/callback is listed as a redirect URI in your Etsy app settings.
 *   3. Run: node scripts/etsy-auth-setup.mjs
 *   4. Open the printed URL in your browser and authorize the app.
 *   5. Copy the printed ETSY_REFRESH_TOKEN into mcp-server/.env and your Claude Desktop config.
 *   6. Clear CLIENT_ID from this file when done (or don't commit it).
 *
 * Requires: Node >= 18 (uses built-in crypto, http, and fetch)
 */

import crypto from "crypto";
import http from "http";
import { URLSearchParams } from "url";

// ─── CONFIGURE THESE ───────────────────────────────────────────────────────
const CLIENT_ID = "YOUR_ETSY_KEYSTRING"; // paste your Keystring here
const REDIRECT_URI = "http://localhost:3003/callback";
const SCOPES = "listings_w listings_r";
// ───────────────────────────────────────────────────────────────────────────

if (CLIENT_ID === "YOUR_ETSY_KEYSTRING") {
  console.error("Error: replace YOUR_ETSY_KEYSTRING with your actual Etsy Keystring before running.");
  process.exit(1);
}

// PKCE helpers
function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

const codeVerifier = base64url(crypto.randomBytes(64));
const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
const state = crypto.randomBytes(16).toString("hex");

const authUrl =
  "https://www.etsy.com/oauth/connect?" +
  new URLSearchParams({
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    client_id: CLIENT_ID,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

console.log("\nOpen this URL in your browser:\n");
console.log(authUrl);
console.log("\nWaiting for redirect on http://localhost:3003/callback ...\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:3003");
  if (url.pathname !== "/callback") { res.end(); return; }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

  if (returnedState !== state) {
    res.end("State mismatch — aborting.");
    server.close();
    return;
  }

  res.end("Authorization successful! You can close this tab.");
  server.close();

  const tokenRes = await fetch("https://api.etsy.com/v3/public/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    console.error("Token exchange failed:", await tokenRes.text());
    process.exit(1);
  }

  const tokens = await tokenRes.json();

  console.log("\n=== SUCCESS — add these to mcp-server/.env and your Claude Desktop config ===\n");
  console.log(`ETSY_API_KEY=${CLIENT_ID}`);
  console.log(`ETSY_CLIENT_ID=${CLIENT_ID}`);
  console.log(`ETSY_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log(
    "\nAccess token (expires in",
    tokens.expires_in,
    "seconds — the MCP server manages refresh automatically):"
  );
  console.log(tokens.access_token);
});

server.listen(3003);
