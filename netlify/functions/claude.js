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
  try { parsed = JSON.parse(event.body); } catch(e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Bad JSON" }) }; }

  const name = parsed.name;
  const prompt = `You are a museum curator creating a detailed life timeline for ${name}.
Return ONLY valid JSON, no markdown, no explanation:
{
  "fullName": "full birth name",
  "born": "YYYY-MM-DD or YYYY",
  "died": "YYYY-MM-DD or YYYY or null",
  "nationality": "nationality",
  "fields": ["field1","field2"],
  "tagline": "one poetic sentence max 12 words",
  "wikipediaSlug": "Wikipedia_Article_Slug",
  "youtubeSearchTerms": ["search term 1 for documentary","search term 2 for interview","search term 3 for performance"],
  "events": [
    {"year":"YYYY","title":"event title","text":"2 sentences about this moment","type":"birth|childhood|education|career|achievement|personal|death","quote":null},
    {"year":"YYYY","title":"","text":"","type":"","quote":"famous quote or null"},
    {"year":"YYYY","title":"","text":"","type":"","quote":null},
    {"year":"YYYY","title":"","text":"","type":"","quote":null},
    {"year":"YYYY","title":"","text":"","type":"","quote":null},
    {"year":"YYYY","title":"","text":"","type":"","quote":null},
    {"year":"YYYY","title":"","text":"","type":"","quote":null},
    {"year":"YYYY","title":"","text":"","type":"","quote":null},
    {"year":"YYYY","title":"","text":"","type":"","quote":null},
    {"year":"YYYY","title":"","text":"","type":"","quote":"famous quote or null"}
  ]
}
Include at least 10 events spanning their entire life from birth to death. The last event must be their death. Include real specific dates where known.`;

  const payload = JSON.stringify({
    model: "claude-haiku-4-5",
    max_tokens: 1800,
    messages: [{ role: "user", content: prompt }]
  });

  const https = require("https");
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.anthropic.com", port: 443, path: "/v1/messages", method: "POST",
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
    req.setTimeout(25000, () => { req.destroy(); resolve({ statusCode: 504, headers, body: JSON.stringify({ error: "Timeout" }) }); });
    req.write(payload); req.end();
  });
};
