const functions = require("@google-cloud/functions-framework");
const crypto = require("crypto");

functions.http("ebayNotifications", (req, res) => {
  if (req.method === "GET") {
    const challenge = req.query.challenge_code;
    if (!challenge) {
      res.status(400).send("Missing challenge_code");
      return;
    }
    const token = process.env.EBAY_VERIFICATION_TOKEN;
    const endpoint = process.env.NOTIFICATION_ENDPOINT_URL;
    if (!token || !endpoint) {
      res.status(500).send("Missing env vars");
      return;
    }
    const hash = crypto
      .createHash("sha256")
      .update(challenge + token + endpoint)
      .digest("hex");
    res.status(200).json({ challengeResponse: hash });
    return;
  }

  // POST: account deletion notification — no user data stored, nothing to delete
  res.status(200).send("OK");
});
