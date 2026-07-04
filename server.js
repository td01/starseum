// Starseum — Express server for Render.com
// Wraps all Netlify functions as /api/* routes
// Fixed IP = YouTube embeds work

const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
app.use(express.json());

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// ── CORS + Referrer headers for YouTube embeds ──
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Helper: make HTTPS request ──
function httpsPost(options, body) {
  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', e => resolve({ status: 502, body: JSON.stringify({ error: e.message }) }));
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 504, body: JSON.stringify({ error: 'Timeout' }) }); });
    if (body) req.write(body);
    req.end();
  });
}

function httpsGet(url) {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(7000, () => { req.destroy(); resolve(null); });
  });
}

// ── /api/claude ──
app.post('/api/claude', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No API key' });

  const parsed = req.body;

  // Q&A mode
  if (parsed.name === '__qa__' && parsed.question) {
    const qaPrompt = `You are a factual guide for a museum about ${parsed.context ? JSON.parse(parsed.context).name : 'this person'}.\nContext: ${parsed.context || ''}\nQuestion: ${parsed.question}\nAnswer in 2-3 sentences, factually and clearly.`;
    const payload = JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: qaPrompt }] });
    const result = await httpsPost({
      hostname: 'api.anthropic.com', port: 443, path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    }, payload);
    return res.status(result.status).send(result.body);
  }

  const name = parsed.name;
  const prompt = `You are a museum curator creating an immersive life timeline for ${name}.
Return ONLY valid JSON, no markdown, no explanation:
{
  "fullName": "full birth name",
  "born": "YYYY-MM-DD or YYYY",
  "died": "YYYY-MM-DD or YYYY",
  "nationality": "nationality",
  "gender": "male or female",
  "fields": ["field1","field2"],
  "tagline": "one evocative sentence max 10 words",
  "wikipediaSlug": "Wikipedia_Article_Slug",
  "birthCity": "City, Country",
  "birthLat": 0.0,
  "birthLng": 0.0,
  "events": [
    {
      "year": "YYYY",
      "title": "Short punchy headline 5 words max",
      "text": "Two vivid sentences about this moment.",
      "type": "birth|childhood|education|career|achievement|interview|personal|death",
      "quote": "a real verified famous quote by them, or null",
      "youtubeId": null,
      "videoSearch": "highly specific YouTube search query"
    }
  ]
}
Rules:
- Include exactly 10 events in chronological order, last must be type "death"
- birthLat and birthLng must be accurate decimal coordinates
- Event 1: type "birth", Event 2: type "childhood", Event 10: type "death"
- At least 3 events of type "interview" with specific TV show names and years
- videoSearch: specific datable event, append "full" or "full interview"
- Quotes must be verified real quotes — use null if uncertain`;

  const payload = JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2400, messages: [{ role: 'user', content: prompt }] });
  const result = await httpsPost({
    hostname: 'api.anthropic.com', port: 443, path: '/v1/messages', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  }, payload);
  res.status(result.status).send(result.body);
});

// ── /api/tourguide ──
app.post('/api/tourguide', async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No ElevenLabs key' });

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
  const payload = JSON.stringify({ text: text.substring(0, 400), model_id: 'eleven_monolingual_v1', voice_settings: { stability: 0.45, similarity_boost: 0.75 } });

  // Must collect binary response as Buffer chunks, not string
  return new Promise((resolve) => {
    const reqEl = https.request({
      hostname: 'api.elevenlabs.io', port: 443,
      path: `/v1/text-to-speech/${VOICE_ID}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'xi-api-key': apiKey,
        'Accept': 'audio/mpeg'
      }
    }, (elRes) => {
      const chunks = [];
      elRes.on('data', chunk => chunks.push(chunk));
      elRes.on('end', () => {
        if (elRes.statusCode === 200) {
          const audioBase64 = Buffer.concat(chunks).toString('base64');
          res.json({ audio: audioBase64 });
        } else {
          res.status(elRes.statusCode).json({ error: 'ElevenLabs error', status: elRes.statusCode });
        }
        resolve();
      });
    });
    reqEl.on('error', e => { res.status(502).json({ error: e.message }); resolve(); });
    reqEl.setTimeout(15000, () => { reqEl.destroy(); res.status(504).json({ error: 'Timeout' }); resolve(); });
    reqEl.write(payload);
    reqEl.end();
  });
});

// ── /api/youtube ──
app.post('/api/youtube', async (req, res) => {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No YouTube key' });

  const { queries } = req.body;
  if (!queries?.length) return res.status(400).json({ error: 'queries required' });

  const TRUSTED = ['vevo','official','archive','bbc','criterion','documentary','classics'];

  function score(c) {
    let s = 0;
    const ch = (c.channelTitle||'').toLowerCase();
    const ti = (c.title||'').toLowerCase();
    if (TRUSTED.some(t => ch.includes(t))) s += 30;
    if (ch.includes('vevo')) s += 20;
    if (ti.includes('full')) s += 10;
    if (ti.includes('interview')) s += 8;
    if (ch.includes('fan') || ti.includes('tribute')) s -= 20;
    return s;
  }

  async function search(query) {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=10&key=${apiKey}`;
    const d = await httpsGet(url);
    if (!d || d.error) { console.error('YT error:', d?.error); return []; }
    return (d.items||[]).filter(i => i.id?.videoId?.length === 11).map(i => ({
      videoId: i.id.videoId,
      title: i.snippet?.title||'',
      channelTitle: i.snippet?.channelTitle||'',
      thumb: i.snippet?.thumbnails?.medium?.url||null,
    }));
  }

  async function findVideos(query) {
    if (!query || query.length < 3) return [];
    const candidates = await search(query);
    if (!candidates.length) return [];
    return candidates.map(c => ({ ...c, score: score(c) })).sort((a,b) => b.score-a.score).slice(0,5);
  }

  const results = await Promise.all(queries.slice(0,8).map(findVideos));
  res.json({ results, version: 7 });
});

// ── Start ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Starseum running on port ${PORT}`));
