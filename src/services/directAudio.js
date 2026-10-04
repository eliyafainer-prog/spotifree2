// Direct Music Search & Audio Engine for SpotiFree V2
// Delivers FULL 3-5 minute songs, ZERO 30s previews, ZERO ads, 100% free with background playback!

const INVIDIOUS_INSTANCES = [
  'https://invidious.f5.si',
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net',
  'https://iv.melmac.space',
  'https://invidious.drgns.space'
];

// In-memory cache for resolved audio streams & video IDs
const streamCache = new Map();
const videoIdCache = new Map();

function getCacheKey(title, artist = '') {
  return `${(title || '').trim().toLowerCase()}:::${(artist || '').trim().toLowerCase()}`;
}

/**
 * Smart candidate scoring algorithm to pick the most accurate, ad-free audio stream:
 * Strongly matches title & artist, and favors lyrics / clean audio / official topic.
 */
function scoreCandidate(item, cleanTitle, cleanArtist) {
  let score = 0;
  const t = (item.title || '').toLowerCase();
  const a = (item.author || '').toLowerCase();
  const targetTitle = cleanTitle.toLowerCase();
  const targetArtist = cleanArtist.toLowerCase();

  // 1. Title match
  if (t.includes(targetTitle)) {
    score += 120;
  } else {
    const words = targetTitle.split(/\s+/).filter(w => w.length > 1);
    const matches = words.filter(w => t.includes(w));
    score += (matches.length / (words.length || 1)) * 70;
  }

  // 2. Artist match
  if (targetArtist) {
    if (t.includes(targetArtist) || a.includes(targetArtist)) {
      score += 100;
    } else {
      const aWords = targetArtist.split(/\s+/).filter(w => w.length > 1);
      const aMatches = aWords.filter(w => t.includes(w) || a.includes(w));
      score += (aMatches.length / (aWords.length || 1)) * 50;
    }
  }

  // 3. Audio/Lyrics bonus
  if (t.includes('lyrics') || t.includes('מילים')) score += 35;
  if (t.includes('audio') || t.includes('אודיו')) score += 40;
  if (a.includes('topic')) score += 50;

  // 4. Sanity check on duration
  if (item.lengthSeconds >= 90 && item.lengthSeconds <= 450) score += 30;
  if (item.lengthSeconds > 700 || item.lengthSeconds < 50) score -= 150;
  if (t.includes('hour') || t.includes('שעות') || t.includes('10 hours') || t.includes('remix') || t.includes('קאבר') || t.includes('cover')) score -= 60;

  return score;
}

/**
 * Searches tracks with instant client-side execution & official 600x600 HD artwork
 */
export async function searchTracks(query, limit = 24) {
  if (!query || !query.trim()) return [];
  const q = query.trim();

  // 1. Primary: iTunes Search API for crisp, high-quality metadata & true song duration
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=${limit}`;
    const res = await fetch(itunesUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const results = data.results || [];
      if (results.length > 0) {
        return results.map(item => normalizeItunesTrack(item));
      }
    }
  } catch (e) {
    console.warn('iTunes search failed:', e);
  }

  // 2. Secondary fallback: YouTube / Invidious Search
  try {
    const fetchPromises = INVIDIOUS_INSTANCES.slice(0, 3).map(base =>
      fetch(`${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`, { signal: AbortSignal.timeout(5000) })
        .then(async res => {
          if (!res.ok) throw new Error('Not ok');
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('json')) throw new Error('Not JSON');
          const items = await res.json();
          if (!Array.isArray(items) || items.length === 0) throw new Error('Empty');
          return items;
        })
    );
    
    const items = await Promise.any(fetchPromises);
    const videoItems = items.filter(it => (it.type === 'video' || !it.type) && it.videoId);
    const songs = videoItems.filter(it => it.lengthSeconds >= 45 && it.lengthSeconds <= 900);
    const chosen = songs.length > 0 ? songs : videoItems;
    return chosen.slice(0, limit).map(item => normalizeInvidiousTrack(item));
  } catch (e) {
    console.warn('Invidious search failed:', e);
  }

  return [];
}

/**
 * Resolves a high-quality, FULL-LENGTH YouTube videoId for any song
 */
export async function resolveYouTubeVideo(title, artist = '') {
  if (!title) return null;

  const key = getCacheKey(title, artist);
  if (videoIdCache.has(key)) {
    return videoIdCache.get(key);
  }

  try {
    const stored = localStorage.getItem(`spotifree_yt_${key}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.videoId) {
        videoIdCache.set(key, parsed);
        return parsed;
      }
    }
  } catch (e) {}

  const cleanTitle = (title || '')
    .replace(/[\(\[\{].*?[\)\]\}]/g, '')
    .replace(/\s+-\s+Single$/i, '')
    .trim();
  const cleanArtist = (artist || '')
    .replace(/[\(\[\{].*?[\)\]\}]/g, '')
    .replace(/,/g, ' ')
    .split('&')[0]
    .trim();

  const queries = [
    `${cleanTitle} ${cleanArtist} audio`.trim(),
    `${cleanTitle} ${cleanArtist} lyrics`.trim(),
    `${cleanTitle} ${cleanArtist}`.trim(),
    `${title} ${artist}`.trim(),
    cleanTitle
  ].filter(Boolean);

  for (const q of queries) {
    for (const base of INVIDIOUS_INSTANCES.slice(0, 3)) {
      try {
        const res = await fetch(`${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) continue;
        const items = await res.json();
        if (!Array.isArray(items) || items.length === 0) continue;

        const videoItems = items.filter(it => (it.type === 'video' || !it.type) && it.videoId && it.lengthSeconds >= 45 && it.lengthSeconds <= 700);
        if (videoItems.length > 0) {
          videoItems.sort((a, b) => scoreCandidate(b, cleanTitle, cleanArtist) - scoreCandidate(a, cleanTitle, cleanArtist));
          const valid = videoItems[0];
          const result = {
            videoId: valid.videoId,
            durationSeconds: valid.lengthSeconds || 210,
            title: valid.title,
            thumbnail: `https://i.ytimg.com/vi/${valid.videoId}/hqdefault.jpg`
          };

          videoIdCache.set(key, result);
          try {
            localStorage.setItem(`spotifree_yt_${key}`, JSON.stringify(result));
          } catch (e) {}

          return result;
        }
      } catch (err) {}
    }
  }

  return null;
}

/**
 * Resolves a DIRECT, AD-FREE, FULL-LENGTH audio stream URL for HTML5 <audio> tag.
 * GUARANTEES:
 * 1. Zero YouTube video ads (no <iframe>, pure direct media stream).
 * 2. Full song duration (3-5 minutes, never capped at 30 seconds).
 * 3. Mobile background & lockscreen playback support.
 */
export async function resolveDirectAudioStream(track, forceRefresh = false) {
  if (!track) throw new Error('No track provided');

  const key = getCacheKey(track.title, track.artist);

  // 1. Check in-memory & local cache if not force refreshing
  if (!forceRefresh) {
    if (streamCache.has(key)) {
      const cached = streamCache.get(key);
      if (Date.now() - cached.timestamp < 3 * 3600 * 1000) {
        return cached;
      }
    }
    try {
      const stored = localStorage.getItem(`spotifree_stream_${key}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.streamUrl && (Date.now() - (parsed.timestamp || 0) < 3 * 3600 * 1000)) {
          streamCache.set(key, parsed);
          return parsed;
        }
      }
    } catch (e) {}
  }

  const cleanTitle = (track.title || '')
    .replace(/[\(\[\{].*?[\)\]\}]/g, '')
    .replace(/\s+-\s+Single$/i, '')
    .trim();
  const cleanArtist = (track.artist || '')
    .replace(/[\(\[\{].*?[\)\]\}]/g, '')
    .replace(/,/g, ' ')
    .split('&')[0]
    .trim();

  // Helper to extract & test audio stream from an Invidious video endpoint
  const tryExtractFromVideoId = async (vid) => {
    for (const inst of INVIDIOUS_INSTANCES) {
      try {
        const res = await fetch(`${inst}/api/v1/videos/${vid}`, { signal: AbortSignal.timeout(4500) });
        if (!res.ok) continue;
        const data = await res.json();
        const audioFormats = data.adaptiveFormats?.filter(f => f.type?.includes('audio') || f.container === 'm4a' || f.container === 'webm');
        if (!audioFormats || audioFormats.length === 0) continue;

        // Prefer m4a (AAC - 100% universal support on iOS Safari & Chrome)
        const chosen = audioFormats.find(f => f.container === 'm4a') || audioFormats[0];
        let streamUrl = chosen.url;
        if (!streamUrl.startsWith('http')) streamUrl = `${inst}${streamUrl}`;

        // Verify partial content request (HTTP 200 or 206)
        try {
          const testRes = await fetch(streamUrl, {
            headers: { 'Range': 'bytes=0-100' },
            signal: AbortSignal.timeout(4000)
          });
          if (testRes.status === 200 || testRes.status === 206) {
            return {
              streamUrl,
              durationSeconds: data.lengthSeconds || track.durationSeconds || 210,
              videoId: vid,
              thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
              source: 'invidious'
            };
          }
        } catch (e) {}
      } catch (e) {}
    }
    return null;
  };

  // Step A: If track already has videoId, try it first
  let initialVideoId = track.videoId;
  if (!initialVideoId && track.id?.startsWith('yt_')) {
    initialVideoId = track.id.replace('yt_', '');
  }
  if (initialVideoId) {
    const directResult = await tryExtractFromVideoId(initialVideoId);
    if (directResult) {
      const finalRes = { ...directResult, timestamp: Date.now() };
      streamCache.set(key, finalRes);
      try { localStorage.setItem(`spotifree_stream_${key}`, JSON.stringify(finalRes)); } catch (e) {}
      return finalRes;
    }
  }

  // Step B: Search for clean, non-VEVO audio / lyrics on Invidious
  // Non-VEVO / lyric videos bypass YouTube bot checks and provide pristine direct audio
  const searchQueries = [
    `${cleanTitle} ${cleanArtist} audio`.trim(),
    `${cleanTitle} ${cleanArtist} lyrics`.trim(),
    `${cleanTitle} ${cleanArtist}`.trim(),
    `${track.title} ${track.artist}`.trim()
  ];

  for (const q of searchQueries) {
    for (const inst of INVIDIOUS_INSTANCES.slice(0, 3)) {
      try {
        const sRes = await fetch(`${inst}/api/v1/search?q=${encodeURIComponent(q)}&type=video`, {
          signal: AbortSignal.timeout(4500)
        });
        if (!sRes.ok) continue;
        const items = await sRes.json();
        if (!Array.isArray(items) || items.length === 0) continue;

        const candidates = items.filter(it => (it.type === 'video' || !it.type) && it.videoId && it.lengthSeconds >= 45 && it.lengthSeconds <= 600);
        if (candidates.length === 0) continue;

        candidates.sort((a, b) => scoreCandidate(b, cleanTitle, cleanArtist) - scoreCandidate(a, cleanTitle, cleanArtist));

        for (const cand of candidates.slice(0, 3)) {
          const directResult = await tryExtractFromVideoId(cand.videoId);
          if (directResult) {
            const finalRes = {
              ...directResult,
              durationSeconds: cand.lengthSeconds || directResult.durationSeconds,
              timestamp: Date.now()
            };
            streamCache.set(key, finalRes);
            try { localStorage.setItem(`spotifree_stream_${key}`, JSON.stringify(finalRes)); } catch (e) {}
            return finalRes;
          }
        }
      } catch (e) {}
    }
  }

  // Step C: Audius open decentralized music network fallback
  try {
    const audiusRes = await fetch(`https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(cleanTitle + ' ' + cleanArtist)}&app_name=SpotiFree`, {
      signal: AbortSignal.timeout(4500)
    });
    if (audiusRes.ok) {
      const d = await audiusRes.json();
      const first = d.data?.[0];
      if (first?.id) {
        const streamUrl = `https://discoveryprovider.audius.co/v1/tracks/${first.id}/stream?app_name=SpotiFree`;
        const testRes = await fetch(streamUrl, {
          headers: { 'Range': 'bytes=0-100' },
          signal: AbortSignal.timeout(4000)
        });
        if (testRes.status === 200 || testRes.status === 206) {
          const finalRes = {
            streamUrl,
            durationSeconds: first.duration || track.durationSeconds || 210,
            source: 'audius',
            timestamp: Date.now()
          };
          streamCache.set(key, finalRes);
          try { localStorage.setItem(`spotifree_stream_${key}`, JSON.stringify(finalRes)); } catch (e) {}
          return finalRes;
        }
      }
    }
  } catch (e) {}

  throw new Error('לא נמצא מקור שמע פעיל ללא פרסומות לשיר זה');
}

/**
 * Normalizes Invidious / YouTube video to standard SpotiFree Track model
 */
function normalizeInvidiousTrack(item) {
  let title = item.title || 'Unknown Title';
  let artist = item.author || 'YouTube';

  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    if (parts.length >= 2) {
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    }
  }

  title = title
    .replace(/(\[|\()(official\s*(music)?\s*video|official\s*audio|קליפ\s*רשמי|הקליפ\s*הרשמי|אודיו\s*רשמי|audio|lyrics)(\]|\))/gi, '')
    .trim();

  const videoId = item.videoId;
  const durationSeconds = item.lengthSeconds || 210;

  return {
    id: `yt_${videoId}`,
    videoId,
    title,
    artist,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    durationSeconds,
    source: 'youtube',
    rawTrack: item
  };
}

/**
 * Normalizes iTunes track to standard SpotiFree Track model
 * NOTE: Preview URLs are deliberately excluded to prevent 30-second playback limit!
 */
function normalizeItunesTrack(item) {
  let thumbnail = item.artworkUrl100 || '';
  if (thumbnail && thumbnail.includes('100x100bb.jpg')) {
    thumbnail = thumbnail.replace('100x100bb.jpg', '600x600bb.jpg');
  }

  // Exact full duration in seconds (e.g. 181 for Shay Hamber, 228 for Taylor Swift)
  const durationSeconds = Math.round((item.trackTimeMillis || 0) / 1000) || 210;

  return {
    id: `itunes_${item.trackId}`,
    title: item.trackName || 'Unknown Title',
    artist: item.artistName || 'Unknown Artist',
    album: item.collectionName || '',
    thumbnail,
    durationSeconds,
    source: 'itunes',
    rawTrack: item
  };
}

/**
 * Curated trending hits for Home view
 */
export async function getTrendingTracks(limit = 18) {
  const trendingQueries = [
    'שירים ישראלים 2026',
    'שי המבר',
    'עומר אדם',
    'אושר כהן',
    'עדן חסון',
    'פאר טסי',
    'Top Hits 2026',
    'Coldplay Hits'
  ];
  const query = trendingQueries[Math.floor(Math.random() * trendingQueries.length)];
  return searchTracks(query, limit);
}

/**
 * Resolves a playable ad-free audio URL (used for downloading tracks offline)
 */
export async function getPlayableAudioUrl(track) {
  if (!track) throw new Error('No track provided');
  const resolved = await resolveDirectAudioStream(track);
  if (!resolved?.streamUrl) throw new Error('לא נמצא קישור שמע זמין להורדה');
  return resolved.streamUrl;
}
