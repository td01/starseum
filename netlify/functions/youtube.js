// YouTube Data API v3
// Strategy: search → Videos API status check → oEmbed real-world embed test → return 5 candidates
// oEmbed (youtube.com/oembed) is the authoritative test: 200 = truly embeddable on 3rd-party sites
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

  function httpsGet(url, followRedirects = true) {
    return new Promise((resolve) => {
      const req = https.get(url, { timeout: 8000 }, (res) => {
        // oEmbed check: we only need the status code, not the body
        if (followRedirects && (res.statusCode === 301 || res.statusCode === 302)) {
          resolve({ statusCode: res.statusCode, location: res.headers.location });
          res.destroy();
          return;
        }
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try { resolve({ statusCode: res.statusCode, body: JSON.parse(data) }); }
          catch(e) { resolve({ statusCode: res.statusCode, body: null }); }
        });
      });
      req.on("error", () => resolve({ statusCode: 0, body: null }));
      req.on("timeout", () => { req.destroy(); resolve({ statusCode: 0, body: null }); });
    });
  }

  // Search YouTube — bias toward official/archive channels with "full" content
  async function ytSearch(query, maxResults = 10) {
    const url = "https://www.googleapis.com/youtube/v3/search"
      + "?part=snippet"
      + "&q=" + encodeURIComponent(query)
      + "&type=video"
      + "&videoEmbeddable=true"
      + "&maxResults=" + maxResults
      + "&key=" + apiKey;
    const res = await httpsGet(url);
    const d = res.body;
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

  // Stage 1: Videos API status check (fast, uses API quota)
  async function statusCheck(videoIds) {
    if (!videoIds.length) return new Set();
    const url = "https://www.googleapis.com/youtube/v3/videos"
      + "?part=status"
      + "&id=" + videoIds.join(",")
      + "&key=" + apiKey;
    const res = await httpsGet(url);
    const d = res.body;
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

  // Stage 2: oEmbed real-world embed test — the authoritative check
  // Returns true if the video will actually embed on a third-party site
  async function oEmbedCheck(videoId) {
    const url = "https://www.youtube.com/oembed"
      + "?url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + videoId)
      + "&format=json";
    const res = await httpsGet(url, false);
    // 200 = embeddable, 401/403 = embed disabled by owner, 404 = not found
    const ok = res.statusCode === 200;
    if (!ok) console.log(`oEmbed blocked (${res.statusCode}): ${videoId}`);
    return ok;
  }

  // Find up to maxCandidates truly embeddable videos for a query
  async function findVideos(query, maxCandidates = 5) {
    if (!query || query.length < 3) return [];

    // Try progressively broader searches
    const attempts = [
      query,
      query.replace(/\d{4}/g, "").replace(/[^a-zA-Z0-9 ]/g, "").trim().split(/\s+/).slice(0, 6).join(" "),
      query.split(" ").slice(0, 4).join(" ")
    ].filter((q, i, arr) => q && q.length >= 3 && arr.indexOf(q) === i);

    for (const q of attempts) {
      const candidates = await ytSearch(q, 12);
      if (!candidates.length) continue;

      // Stage 1: Videos API status filter (eliminates private/deleted/non-embeddable)
      const ids = candidates.map(c => c.videoId);
      const statusOk = await statusCheck(ids);
      const stage1 = candidates.filter(c => statusOk.has(c.videoId));
      if (!stage1.length) {
        console.log(`"${q}": all ${candidates.length} failed status check`);
        continue;
      }

      // Stage 2: oEmbed test — real-world embed permission check
      // Test in parallel but cap at 6 to avoid timeout
      const toTest = stage1.slice(0, 6);
      const oEmbedResults = await Promise.all(toTest.map(c => oEmbedCheck(c.videoId)));
      const verified = toTest.filter((_, i) => oEmbedResults[i]);

      if (verified.length > 0) {
        console.log(`"${q}": ${verified.length}/${toTest.length} passed oEmbed check`);
        return verified.slice(0, maxCandidates);
      }
      console.log(`"${q}": 0 passed oEmbed from ${stage1.length} status-ok candidates`);
    }

    console.log(`No embeddable video found for: "${query}"`);
    return [];
  }

  // Process queries in parallel (cap at 8 to stay within Netlify function timeout)
  const allResults = await Promise.all(
    queries.slice(0, 8).map(q => findVideos(q, 5))
  );

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ results: allResults })
  };
};
