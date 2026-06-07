// YouTube Data API v3 search — finds real embeddable video IDs
exports.handler = async function(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "No YouTube API key" }) };

  let body;
  try { body = JSON.parse(event.body); } catch(e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Bad JSON" }) }; }

  const { queries } = body; // array of search strings
  if (!queries || !Array.isArray(queries)) return { statusCode: 400, headers, body: JSON.stringify({ error: "queries array required" }) };

  const https = require("https");

  async function searchYouTube(query) {
    return new Promise((resolve) => {
      const q = encodeURIComponent(query);
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&type=video&videoEmbeddable=true&maxResults=3&key=${apiKey}`;
      https.get(url, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const d = JSON.parse(data);
            const items = d.items || [];
            // Return first result with a valid videoId
            const found = items.find(i => i.id?.videoId);
            resolve(found ? { videoId: found.id.videoId, title: found.snippet?.title, thumb: found.snippet?.thumbnails?.medium?.url } : null);
          } catch(e) { resolve(null); }
        });
      }).on("error", () => resolve(null));
    });
  }

  // Run all queries in parallel (max 5 at once to stay within quota)
  const results = await Promise.all(queries.slice(0, 5).map(q => searchYouTube(q)));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ results }) // array matching queries order, null if not found
  };
};
