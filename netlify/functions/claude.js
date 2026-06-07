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

  // Q&A mode
  if (parsed.name === '__qa__' && parsed.question) {
    const qaPrompt = `You are a factual guide for a museum about ${parsed.context ? JSON.parse(parsed.context).name : 'this person'}.
Context: ${parsed.context || ''}
Question: ${parsed.question}
Answer in 2-3 sentences, factually and clearly. Do not make things up. If uncertain, say so.`;
    const qaPayload = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: qaPrompt }]
    });
    return new Promise((resolve) => {
      const https = require("https");
      const req = https.request({
        hostname: "api.anthropic.com", port: 443, path: "/v1/messages", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(qaPayload), "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
      }, (res) => {
        let data = ""; res.on("data", c => data += c);
        res.on("end", () => resolve({ statusCode: res.statusCode, headers, body: data }));
      });
      req.on("error", e => resolve({ statusCode: 502, headers, body: JSON.stringify({ error: e.message }) }));
      req.write(qaPayload); req.end();
    });
  }

  const name = parsed.name;
  const prompt = `You are a museum curator creating an immersive life timeline for ${name}.
Return ONLY valid JSON, no markdown, no explanation:
{
  "fullName": "full birth name",
  "born": "YYYY-MM-DD or YYYY",
  "died": "YYYY-MM-DD or YYYY",
  "nationality": "nationality",
  "fields": ["field1","field2"],
  "tagline": "one evocative sentence max 10 words",
  "wikipediaSlug": "Wikipedia_Article_Slug",
  "birthCity": "City, Country",
  "birthLat": 0.0,
  "birthLng": 0.0,
  "events": [
    {
      "year": "YYYY",
      "title": "Short punchy headline 5 words max",
      "text": "Two vivid sentences about this moment.",
      "type": "birth|childhood|education|career|achievement|personal|death",
      "quote": "a real verified famous quote by them, or null",
      "youtubeId": "real 11-char YouTube video ID or null",
      "videoSearch": "highly specific YouTube search query e.g. '${name} BBC interview 1987' or '${name} live performance 1975 concert' or '${name} documentary full' — must be unique per event and findable on YouTube"
    }
  ]
}
Rules:
- Include exactly 10 events in chronological order, last must be type "death"
- birthLat and birthLng must be accurate decimal coordinates for their birthplace
- The first event (birth) should have type "birth" — leave youtubeId null
- The second event must be type "childhood" covering ages 5–15: formative years, family, upbringing
- youtubeId: only include an ID you are CERTAIN exists on YouTube right now. Leave null if any doubt. Do not guess.
- videoSearch: REQUIRED for every event. Make each query highly specific and distinct — include the person's name, a specific year or era, and the nature of footage (interview, performance, documentary, speech, match, fight, film clip). Bad: "${name} video". Good: "${name} live at Wembley 1986" or "${name} CBS interview 1994" or "${name} championship final 1988"
- Quotes must be verified real quotes — use null if uncertain`;

  const payload = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2400,
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
