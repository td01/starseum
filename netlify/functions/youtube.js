// YouTube Data API v3 — searches for real embeddable videos
// Strategy: try specific query first, fall back to broader searches
exports.handler = async function(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "No YouTube API key configured" }) };

  let body;
  try { body = JSON.parse(event.body); } catch(e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Bad JSON" }) }; }
  const { queries } = body;
  if (!queries?.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "queries required" }) };

  const https = require("https");

  function ytSearch(query) {
    return new Promise((resolve) => {
      const url = "https://www.googleapis.com/youtube/v3/search?part=snippet"
        + "&q=" + encodeURIComponent(query)
        + "&type=video&videoEmbeddable=true&videoDuration=medium"
        + "&maxResults=5&key=" + apiKey;
      https.get(url, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try {
            const d = JSON.parse(data);
            if (d.error) { console.error("YT error:", d.error.code, d.error.message); resolve(null); return; }
            const item = (d.items || []).find(i => i.id?.videoId?.length === 11);
            resolve(item ? { videoId: item.id.videoId, title: item.snippet?.title, thumb: item.snippet?.thumbnails?.medium?.url } : null);
          } catch(e) { resolve(null); }
        });
      }).on("error", () => resolve(null));
    });
  }

  async function findVideo(query) {
    // Strategy: try 3 increasingly broad searches
    const attempts = [
      query,
      // Remove years and special chars, keep name + 2 key words
      query.replace(/\d{4}/g, '').replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/).slice(0, 4).join(' '),
      // Just first 3 words (usually "Name Action")
      query.split(' ').slice(0, 3).join(' ')
    ].filter((q, i, arr) => q && arr.indexOf(q) === i); // deduplicate

    for (const q of attempts) {
      if (!q || q.length < 3) continue;
      const result = await ytSearch(q);
      if (result) {
        console.log(`Found video for "${q}": ${result.videoId}`);
        return result;
      }
    }
    console.log(`No video found for: ${query}`);
    return null;
  }

  const results = await Promise.all(queries.slice(0, 5).map(findVideo));
  return { statusCode: 200, headers, body: JSON.stringify({ results }) };
};
