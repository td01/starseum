const https = require("https");

exports.handler = async function(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "API key not configured" }) };
  }

  let parsed;
  try { parsed = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Bad request" }) }; }

  const payload = JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: parsed.max_tokens || 1400,
    messages: parsed.messages
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        resolve({ statusCode: res.statusCode, headers, body: data });
      });
    });
    req.on("error", (e) => {
      resolve({ statusCode: 500, headers, body: JSON.stringify({ error: e.message }) });
    });
    req.write(payload);
    req.end();
  });
};
