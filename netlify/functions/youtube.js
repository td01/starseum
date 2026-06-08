// YouTube Data API v3
// Fast two-step: search → Videos API batch status check → scored ranking → 5 candidates
// oEmbed removed: too slow for Netlify's 10s timeout. Reliability via scoring instead.
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
      const req = https.get(url, { timeout: 6000 }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
        });
      });
      req.on("error", () => resolve(null));
      req.on("timeout", () => { req.destroy(); resolve(null); });
    });
  }

  // Channels that reliably allow third-party embeds
  const TRUSTED_CHANNELS = [
    'vevo', 'official', 'archive', 'remastered', 'bbc',
    'criterion', 'documentary', 'classics', 'heritage',
    'museum', 'library', 'arts', 'culture', 'film'
  ];

  // Score a candidate — higher = more likely to embed
  function scoreCandidate(c) {
    let score = 0;
    const ch = (c.channelTitle || '').toLowerCase();
    const title = (c.title || '').toLowerCase();
    // Trusted channel types
    if (TRUSTED_CHANNELS.some(t => ch.includes(t))) score += 30;
    // Official/VEVO channels are very reliable
    if (ch.includes('vevo')) score += 20;
    if (ch.includes('official')) score += 15;
    // Full content scores better than clips
    if (title.includes('full')) score += 10;
    if (title.includes('complete')) score += 8;
    if (title.includes('interview')) score += 8;
    if (title.includes('concert') || title.includes('live')) score += 6;
    if (title.includes('documentary')) score += 6;
    // Penalise likely fan reuploads
    if (ch.includes('fan') || title.includes('tribute')) score -= 20;
    if (title.includes('reaction') || title.includes('cover')) score -= 15;
    return score;
  }

  async function ytSearch(query, maxResults = 10) {
    const url = "https://www.googleapis.com/youtube/v3/search"
      + "?part=snippet"
      + "&q=" + encodeURIComponent(query)
      + "&type=video"
      + "&videoEmbeddable=true"
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
      }));
  }

  // Batch status check for all IDs at once (one API call)
  async function batchStatusCheck(videoIds) {
    if (!videoIds.length) return new Set();
    const url = "https://www.googleapis.com/youtube/v3/videos"
      + "?part=status"
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

  async function findVideos(query, maxCandidates = 5) {
    if (!query || query.length < 3) return [];

    const attempts = [
      query,
      query.replace(/\d{4}/g, "").replace(/[^a-zA-Z0-9 ]/g, "").trim().split(/\s+/).slice(0, 5).join(" "),
      query.split(" ").slice(0, 3).join(" ")
    ].filter((q, i, arr) => q && q.length >= 3 && arr.indexOf(q) === i);

    for (const q of attempts) {
      const candidates = await ytSearch(q, 10);
      if (!candidates.length) continue;

      // Single batch call to verify status
      const ids = candidates.map(c => c.videoId);
      const okIds = await batchStatusCheck(ids);
      const verified = candidates.filter(c => okIds.has(c.videoId));

      if (!verified.length) {
        console.log(`"${q}": 0 passed status check from ${candidates.length}`);
        continue;
      }

      // Score and sort — best candidates first
      const scored = verified
        .map(c => ({ ...c, score: scoreCandidate(c) }))
        .sort((a, b) => b.score - a.score);

      console.log(`"${q}": ${scored.length} ok, top="${scored[0]?.title}" score=${scored[0]?.score}`);
      return scored.slice(0, maxCandidates);
    }

    console.log(`No video found for: "${query}"`);
    return [];
  }

  // Run up to 8 queries in parallel — each is just 2 API calls (search + status)
  const allResults = await Promise.all(
    queries.slice(0, 8).map(q => findVideos(q, 5))
  );

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ results: allResults })
  };
};
