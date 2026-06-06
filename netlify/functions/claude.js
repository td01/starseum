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
  const prompt = `You are a museum curator creating an immersive life timeline for ${name}.
Return ONLY valid JSON, no markdown, no explanation:
{
  "fullName": "full birth name",
  "born": "YYYY-MM-DD or YYYY",
  "died": "YYYY-MM-DD or YYYY or null",
  "nationality": "nationality",
  "fields": ["field1","field2"],
  "tagline": "one evocative sentence max 10 words",
  "wikipediaSlug": "Wikipedia_Article_Slug",
  "events": [
    {
      "year": "YYYY",
      "title": "Short punchy headline 5 words max",
      "text": "Two vivid sentences about this moment.",
      "type": "birth|childhood|education|career|achievement|personal|death",
      "quote": "a real verified famous quote by them or null",
      "youtubeId": "a real 11-character YouTube video ID for footage directly related to this event, or null"
    }
  ]
}
Include exactly 10 events from birth to death in chronological order. Last event must be type death.
For youtubeId: provide REAL YouTube video IDs (11 characters) for actual videos that exist on YouTube. Examples of format: dQw4w9WgXcQ, jNQXAC9IVRw. Include documentary clips, performances, interviews, speeches, film trailers, news coverage. At least 4 events should have real youtubeId values. For the death event always try to include a tribute or documentary video ID.
Only include youtubeId values you are highly confident exist on YouTube. Use null if uncertain.
Quotes must be real — use null if uncertain.`;

  const payload = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2200,
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
