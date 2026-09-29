// Vercel / Netlify Serverless API Proxy for SoundCloud Search & Streams
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { path = '', q = '', client_id = 'pmagYZKQF6mRtNmtRzPkXSQJ76jYHLN8', limit = '24' } = req.query;

  try {
    let targetUrl = '';
    if (path) {
      targetUrl = `https://api-v2.soundcloud.com${path}?client_id=${client_id}`;
    } else if (q) {
      targetUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${client_id}&limit=${limit}`;
    } else {
      return res.status(400).json({ error: 'Missing path or query' });
    }

    const scRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });

    if (!scRes.ok) {
      return res.status(scRes.status).json({ error: 'SoundCloud API error' });
    }

    const data = await scRes.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
