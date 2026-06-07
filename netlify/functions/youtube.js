// YouTube Data API v3 — searches for embeddable videos
// Strategy: search → verify embeddability via Videos API → return up to 3 candidates per query
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
  try { body = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Bad JSON" }) };
  }
  const { queries } = body;
  if (!queries?.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "queries required" }) };

  const https = require("https");

  // Perform a YouTube search and return raw candidate video IDs + metadata
  function ytSearch(query, maxResults = 8) {
    return new Promise((resolve) => {
      const url = "https://www.googleapis.com/youtube/v3/search"
        + "?part=snippet"
        + "&q=" + encodeURIComponent(query)
        + "&type=video"
        + "&videoEmbeddable=true"
        + "&maxResults=" + maxResults
        + "&key=" + apiKey;
      https.get(url, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try {
            const d = JSON.parse(data);
            if (d.error) { console.error("YT search error:", d.error.code, d.error.message); resolve([]); return; }
            resolve((d.items || [])
              .filter(i => i.id?.videoId?.length === 11)
              .map(i => ({
                videoId: i.id.videoId,
                title: i.snippet?.title || "",
                thumb: i.snippet?.thumbnails?.medium?.url || null,
                channelTitle: i.snippet?.channelTitle || ""
              })));
          } catch(e) { resolve([]); }
        });
      }).on("error", () => resolve([]));
    });
  }

  // Verify that a list of video IDs are truly embeddable via the Videos API
  // Returns a Set of confirmed embeddable IDs
  function verifyEmbeddable(videoIds) {
    if (!videoIds.length) return Promise.resolve(new Set());
    return new Promise((resolve) => {
      const url = "https://www.googleapis.com/youtube/v3/videos"
        + "?part=status,contentDetails"
        + "&id=" + videoIds.join(",")
        + "&key=" + apiKey;
      https.get(url, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try {
            const d = JSON.parse(data);
            const embeddable = new Set(
              (d.items || [])
                .filter(i => i.status?.embeddable === true && i.status?.uploadStatus === "processed")
                .map(i => i.id)
            );
            resolve(embeddable);
          } catch(e) { resolve(new Set()); }
        });
      }).on("error", () => resolve(new Set()));
    });
  }

  // Find up to `maxCandidates` verified embeddable videos for a query
  async function findVideos(query, maxCandidates = 3) {
    // Try specific query first, then progressively broader fallbacks
    const attempts = [
      query,
      query.replace(/\d{4}/g, "").replace(/[^a-zA-Z0-9 ]/g, "").trim().split(/\s+/).slice(0, 5).join(" "),
      query.split(" ").slice(0, 3).join(" ")
    ].filter((q, i, arr) => q && q.length >= 3 && arr.indexOf(q) === i);

    for (const q of attempts) {
      const candidates = await ytSearch(q, 8);
      if (!candidates.length) continue;

      // Verify embeddability in bulk
      const ids = candidates.map(c => c.videoId);
      const embeddable = await verifyEmbeddable(ids);

      const verified = candidates.filter(c => embeddable.has(c.videoId));
      if (verified.length > 0) {
        console.log(`Query "${q}": found ${verified.length} embeddable videos`);
        // Return up to maxCandidates so client can fall back if first fails
        return verified.slice(0, maxCandidates);
      }
    }
    console.log(`No embeddable video found for: "${query}"`);
    return [];
  }

  // Run all queries in parallel (cap at 8 to stay within quota)
  const allResults = await Promise.all(
    queries.slice(0, 8).map(q => findVideos(q, 3))
  );

  // Each result is an array of candidates; client picks first that plays
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ results: allResults })
  };
};
