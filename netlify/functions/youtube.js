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

  const { queries } = body;
  if (!queries || !Array.isArray(queries)) return { statusCode: 400, headers, body: JSON.stringify({ error: "queries array required" }) };

  const https = require("https");

  async function searchYouTube(query) {
    // Try the original query first, then fall back to shorter version
    const attempts = [
      query.substring(0, 60),
      query.split(' ').slice(0, 3).join(' '), // first 3 words only
    ];
    
    for (const q of attempts) {
      const result = await trySearch(encodeURIComponent(q));
      if (result) return result;
    }
    return null;
  }

  function trySearch(encodedQuery) {
    return new Promise((resolve) => {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodedQuery}&type=video&videoEmbeddable=true&videoDuration=medium&maxResults=5&key=${apiKey}`;
      https.get(url, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const d = JSON.parse(data);
            if (d.error) { console.error('YouTube API error:', d.error.message); resolve(null); return; }
            const items = d.items || [];
            // Find first result that looks legitimate (has a real videoId)
            const found = items.find(i => i.id?.videoId && i.id.videoId.length === 11);
            if (found) {
              resolve({ 
                videoId: found.id.videoId, 
                title: found.snippet?.title,
                thumb: found.snippet?.thumbnails?.medium?.url 
              });
            } else {
              resolve(null);
            }
          } catch(e) { resolve(null); }
        });
      }).on("error", () => resolve(null));
    });
  }

  // Process up to 5 queries in parallel
  const results = await Promise.all(queries.slice(0, 5).map(q => searchYouTube(q)));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ results })
  };
};
