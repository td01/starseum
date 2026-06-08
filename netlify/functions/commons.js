// Wikimedia Commons video search — no API key, no quota, always embeddable
// Returns direct file URLs (.ogv/.webm) playable via HTML5 <video> element
// Falls back to Wikimedia media viewer embed URL
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
      const req = https.get(url, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
        });
      });
      req.on("error", () => resolve(null));
      req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    });
  }

  // Search Wikimedia Commons for video files matching a query
  async function searchCommons(query) {
    // Search in File namespace (6) for video files
    const url = "https://commons.wikimedia.org/w/api.php"
      + "?action=query"
      + "&list=search"
      + "&srsearch=" + encodeURIComponent(query + " filetype:video")
      + "&srnamespace=6"
      + "&srlimit=5"
      + "&format=json"
      + "&origin=*";
    const d = await httpsGet(url);
    if (!d) return [];
    return (d.query?.search || [])
      .filter(r => /\.(ogv|webm|mp4)$/i.test(r.title));
  }

  // Get the direct file URL and thumbnail from Commons
  async function getFileInfo(title) {
    const url = "https://commons.wikimedia.org/w/api.php"
      + "?action=query"
      + "&titles=" + encodeURIComponent(title)
      + "&prop=imageinfo"
      + "&iiprop=url|thumburl|extmetadata"
      + "&iiextmetadatafilter=ObjectName|ImageDescription"
      + "&iiurlwidth=320"
      + "&format=json"
      + "&origin=*";
    const d = await httpsGet(url);
    if (!d) return null;
    const page = Object.values(d.query?.pages || {})[0];
    const info = page?.imageinfo?.[0];
    if (!info?.url) return null;
    const meta = info.extmetadata || {};
    return {
      fileUrl: info.url,           // direct .ogv/.webm URL
      thumbUrl: info.thumburl || null,
      title: meta.ObjectName?.value || title.replace('File:', '').replace(/\.\w+$/, ''),
      description: meta.ImageDescription?.value?.replace(/<[^>]+>/g, '').substring(0, 120) || '',
      pageUrl: "https://commons.wikimedia.org/wiki/" + encodeURIComponent(title),
      source: 'commons'
    };
  }

  async function findCommonsVideo(query) {
    // Try specific query first, then star name only
    const attempts = [
      query,
      query.split(' ').slice(0, 3).join(' ')
    ].filter((q, i, arr) => q && q.length >= 3 && arr.indexOf(q) === i);

    for (const q of attempts) {
      const results = await searchCommons(q);
      if (!results.length) continue;
      // Get file info for first result
      const info = await getFileInfo(results[0].title);
      if (info) {
        console.log(`Commons found for "${q}": ${info.fileUrl.substring(0, 80)}`);
        return info;
      }
    }
    return null;
  }

  // Process all queries in parallel
  const allResults = await Promise.all(
    queries.slice(0, 8).map(findCommonsVideo)
  );

  console.log('commons.js: found', allResults.filter(Boolean).length, 'of', queries.length, 'queries');

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ results: allResults })
  };
};
