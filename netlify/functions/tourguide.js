// ElevenLabs TTS for tour guide narration
exports.handler = async function(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "No ElevenLabs API key" }) };

  let body;
  try { body = JSON.parse(event.body); } catch(e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Bad JSON" }) }; }

  const { text, voiceId = "21m00Tcm4TlvDq8ikWAM" } = body; // Default: Rachel voice
  if (!text) return { statusCode: 400, headers, body: JSON.stringify({ error: "text required" }) };

  const https = require("https");
  const payload = JSON.stringify({
    text,
    model_id: "eleven_monolingual_v1",
    voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true }
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.elevenlabs.io",
      path: `/v1/text-to-speech/${voiceId}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "xi-api-key": apiKey,
        "Accept": "audio/mpeg"
      }
    }, (res) => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          resolve({ statusCode: res.statusCode, headers, body: JSON.stringify({ error: "ElevenLabs error " + res.statusCode }) });
          return;
        }
        const audio = Buffer.concat(chunks).toString("base64");
        resolve({
          statusCode: 200,
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ audio, mimeType: "audio/mpeg" })
        });
      });
    });
    req.on("error", e => resolve({ statusCode: 502, headers, body: JSON.stringify({ error: e.message }) }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ statusCode: 504, headers, body: JSON.stringify({ error: "Timeout" }) }); });
    req.write(payload);
    req.end();
  });
};
