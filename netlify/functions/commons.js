// Wikimedia Commons video search — no API key, no quota
// Uses correct API syntax for file search
exports.handler = async function(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  let body;
  try { body = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Bad JSON" }) };
  }
  const { queries } = body;
  if (!queries?.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "queries required" }) };

  const https = require("https");

  function httpsGet(url) {
    return new Promise((resolve) => {
      const options = new URL(url);
      const req = https.get({
        hostname: options.hostname,
        path: options.pathname + options.search,
        headers: { 'User-Agent': 'Starseum/1.0 (https://starseum.netlify.app)' }
      }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
        });
      });
      req.on("error", (e) => { console.error("httpsGet error:", e.message); resolve(null); });
      req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    });
  }

  // Search Commons using allimages API which supports MIME type filtering
  async function searchCommonsVideo(starName) {
    // Use allimages with mime type filter — most reliable way to find videos
    const url = "https://commons.wikimedia.org/w/api.php"
      + "?action=query"
      + "&list=allimages"
      + "&aiprop=url|mime|extmetadata"
      + "&aimime=video/webm|video/ogg|application/ogg"
      + "&aiprefix=" + encodeURIComponent(starName.split(' ')[0]) // search by first name
      + "&ailimit=10"
      + "&format=json";

    const d = await httpsGet(url);
    if (!d) return null;

    const images = d.query?.allimages || [];
    // Find video files that mention the star's full name in title
    const lowerName = starName.toLowerCase();
    const match = images.find(img =>
      img.title.toLowerCase().includes(lowerName.split(' ')[0].toLowerCase()) &&
      /\.(ogv|webm|ogg)$/i.test(img.title)
    ) || images.find(img => /\.(ogv|webm|ogg)$/i.test(img.title));

    if (!match) return null;
    return {
      fileUrl: match.url,
      thumbUrl: match.thumburl || null,
      title: match.title.replace('File:', '').replace(/\.\w+$/, ''),
      pageUrl: "https://commons.wikimedia.org/wiki/" + encodeURIComponent(match.title),
      source: 'commons'
    };
  }

  // Also try fulltext search for video files
  async function searchCommonsFulltext(query) {
    const url = "https://commons.wikimedia.org/w/api.php"
      + "?action=query"
      + "&list=search"
      + "&srsearch=" + encodeURIComponent(query)
      + "&srnamespace=6"
      + "&srlimit=10"
      + "&srprop=title|snippet"
      + "&format=json";

    const d = await httpsGet(url);
    if (!d) return null;

    const results = (d.query?.search || [])
      .filter(r => /\.(ogv|webm|ogg|mp4)$/i.test(r.title));

    if (!results.length) return null;

    // Get URL for first video file result
    const title = results[0].title;
    const infoUrl = "https://commons.wikimedia.org/w/api.php"
      + "?action=query"
      + "&titles=" + encodeURIComponent(title)
      + "&prop=imageinfo"
      + "&iiprop=url|mime"
      + "&format=json";

    const info = await httpsGet(infoUrl);
    if (!info) return null;

    const page = Object.values(info.query?.pages || {})[0];
    const imgInfo = page?.imageinfo?.[0];
    if (!imgInfo?.url) return null;

    return {
      fileUrl: imgInfo.url,
      thumbUrl: null,
      title: title.replace('File:', '').replace(/\.\w+$/, ''),
      pageUrl: "https://commons.wikimedia.org/wiki/" + encodeURIComponent(title),
      source: 'commons'
    };
  }

  async function findVideo(query) {
    // Extract star name (first 2-3 words of query)
    const starName = query.split(' ').slice(0, 3).join(' ');

    // Try fulltext search first (more precise)
    const result = await searchCommonsFulltext(query)
      || await searchCommonsFulltext(starName)
      || await searchCommonsVideo(starName);

    if (result) console.log(`Found Commons video for "${query}": ${result.fileUrl.substring(0, 80)}`);
    else console.log(`No Commons video for "${query}"`);
    return result;
  }

  const allResults = await Promise.all(queries.slice(0, 8).map(findVideo));
  const found = allResults.filter(Boolean).length;
  console.log(`commons.js: ${found}/${queries.length} found`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ results: allResults })
  };
};
