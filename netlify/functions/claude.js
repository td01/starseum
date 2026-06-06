exports.handler = async function(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;
  
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod === "GET") return { statusCode: 200, headers, body: JSON.stringify({ status: "ok" }) };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "No API key" }) };

  let parsed;
  try { parsed = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Bad JSON" }) }; }

  const name = parsed.name;
  
  const prompt = `Museum timeline for ${name}. Reply with ONLY this JSON, no other text:
{"fullName":"","born":"","died":"","nationality":"","fields":[""],"tagline":"","wikipediaSlug":"","youtubeId":"","chapters":[{"id":"origins","label":"Origins","year":"","title":"","text":"","quote":null},{"id":"rise","label":"Rise","year":"","title":"","text":"","quote":""},{"id":"peak","label":"Peak","year":"","title":"","text":"","quote":null},{"id":"legacy","label":"Legacy","year":"","title":"","text":"","quote":""}]}`;

  const payload = JSON.stringify({
    model: "claude-haiku-4-5",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }]
  });

  const https = require("https");

  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.anthropic.com",
      port: 443,
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ statusCode: res.statusCode, headers, body: data }));
    });

    req.on("error", e => resolve({ statusCode: 502, headers, body: JSON.stringify({ error: e.message }) }));
    req.setTimeout(9000, () => {
      req.destroy();
      resolve({ statusCode: 504, headers, body: JSON.stringify({ error: "Timeout - please try again" }) });
    });
    req.write(payload);
    req.end();
  });
};
