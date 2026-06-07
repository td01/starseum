// YouTube Data API v3
// Strategy: search → verify embeddability via Videos API → return up to 3 candidates
// Each result is an array of verified embeddable candidates for fallback chaining
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

  function httpsGet(url) {
    return new Promise((resolve) => {
      https.get(url, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
        });
      }).on("error", () => resolve(null));
    });
  }

  // Search YouTube and return candidate video objects
  async function ytSearch(query, maxResults = 10) {
    const url = "https://www.googleapis.com/youtube/v3/search"
      + "?part=snippet"
      + "&q=" + encodeURIComponent(query)
      + "&type=video"
      + "&videoEmbeddable=true"
      + "&videoSyndicated=true"
      + "&maxResults=" + maxResults
      + "&key=" + apiKey;
    const d = await httpsGet(url);
    if (!d || d.error) {
      console.error("YT search error:", d?.error?.code, d?.error?.message);
      return [];
    }
    return (d.items || [])
      .filter(i => i.id?.videoId?.length === 11)
      .map(i => ({
        videoId: i.id.videoId,
        title: i.snippet?.title || "",
        channelTitle: i.snippet?.channelTitle || "",
        thumb: i.snippet?.thumbnails?.medium?.url || null,
        publishedAt: i.snippet?.publishedAt || ""
      }));
  }

  // Verify embeddability via Videos API — returns Set of confirmed embeddable IDs
  async function verifyEmbeddable(videoIds) {
    if (!videoIds.length) return new Set();
    const url = "https://www.googleapis.com/youtube/v3/videos"
      + "?part=status,contentDetails"
      + "&id=" + videoIds.join(",")
      + "&key=" + apiKey;
    const d = await httpsGet(url);
    if (!d) return new Set();
    return new Set(
      (d.items || [])
        .filter(i =>
          i.status?.embeddable === true &&
          i.status?.uploadStatus === "processed" &&
          i.status?.privacyStatus === "public"
        )
        .map(i => i.id)
    );
  }

  // Find up to maxCandidates verified embeddable videos for a single query
  async function findVideos(query, maxCandidates = 3) {
    if (!query || query.length < 3) return [];

    // Try increasingly broad fallbacks
    const attempts = [
      query,
      query.replace(/\d{4}/g, "").replace(/[^a-zA-Z0-9 ]/g, "").trim().split(/\s+/).slice(0, 6).join(" "),
      query.split(" ").slice(0, 4).join(" ")
    ].filter((q, i, arr) => q && q.length >= 3 && arr.indexOf(q) === i);

    for (const q of attempts) {
      const candidates = await ytSearch(q, 10);
      if (!candidates.length) continue;

      const ids = candidates.map(c => c.videoId);
      const embeddable = await verifyEmbeddable(ids);
      const verified = candidates.filter(c => embeddable.has(c.videoId));

      if (verified.length > 0) {
        console.log(`"${q}": ${verified.length} verified embeddable`);
        return verified.slice(0, maxCandidates);
      }
      console.log(`"${q}": 0 embeddable from ${candidates.length} results`);
    }

    console.log(`No embeddable video for: "${query}"`);
    return [];
  }

  // Process all queries in parallel
  const allResults = await Promise.all(
    queries.slice(0, 8).map(q => findVideos(q, 3))
  );

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ results: allResults })
  };
};
