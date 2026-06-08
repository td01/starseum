// YouTube Data API v3 — Starseum v4 (2026-06-08)
// Fast scoring approach: search → score by channel/title → return array of candidates
// Each query returns an ARRAY of candidate objects [{videoId, title, thumb, score}]
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
      const req = https.get(url, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
        });
      });
      req.on("error", (e) => { console.error("httpsGet error:", e.message); resolve(null); });
      req.setTimeout(7000, () => { console.error("httpsGet timeout:", url.substring(0,80)); req.destroy(); resolve(null); });
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

  async function findVideos(query, maxCandidates = 5) {
    if (!query || query.length < 3) return [];

    const attempts = [
      query,
      query.replace(/\d{4}/g, "").replace(/[^a-zA-Z0-9 ]/g, "").trim().split(/\s+/).slice(0, 5).join(" "),
      query.split(" ").slice(0, 3).join(" ")
    ].filter((q, i, arr) => q && q.length >= 3 && arr.indexOf(q) === i);

    for (const q of attempts) {
      const candidates = await ytSearch(q, 10);
      if (!candidates.length) {
        console.log(`"${q}": no search results`);
        continue;
      }
      // Score and sort — best candidates first, no status check (quota risk)
      const scored = candidates
        .map(c => ({ ...c, score: scoreCandidate(c) }))
        .sort((a, b) => b.score - a.score);

      console.log(`"${q}": ${scored.length} results, top="${scored[0]?.title}" ch="${scored[0]?.channelTitle}" score=${scored[0]?.score}`);
      return scored.slice(0, maxCandidates);
    }

    console.log(`No results for: "${query}"`);
    return [];
  }

  // Run up to 8 queries in parallel
  const allResults = await Promise.all(
    queries.slice(0, 8).map(q => findVideos(q, 5))
  );

  // Log summary so Netlify function logs confirm this version is running
  console.log('youtube.js v4 returning', allResults.length, 'result arrays, counts:', allResults.map(r=>r.length));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ results: allResults, version: 4 })
  };
};
