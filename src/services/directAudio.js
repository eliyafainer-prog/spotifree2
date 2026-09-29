// Direct Music Search & Audio Engine for SpotiFree V2
// Delivers FULL 3-6 minute songs, zero server needed, 100% free on GitHub Pages!

const INVIDIOUS_INSTANCES = [
  'https://invidious.f5.si',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://vid.puffyan.us',
  'https://yt.artemislena.eu',
  'https://invidious.private.coffee'
];

// In-memory cache for resolved YouTube video IDs
const videoIdCache = new Map();

// Helper to normalize cache key
function getCacheKey(title, artist = '') {
  return `${(title || '').trim().toLowerCase()}:::${(artist || '').trim().toLowerCase()}`;
}

/**
 * Resolves a high-quality YouTube videoId for any song (title + artist)
 * Returns { videoId, title, durationSeconds, thumbnail }
 */
export async function resolveYouTubeVideo(title, artist = '') {
  if (!title) return null;

  const key = getCacheKey(title, artist);
  if (videoIdCache.has(key)) {
    return videoIdCache.get(key);
  }

  // Also check localStorage for persistent instant load
  try {
    const stored = localStorage.getItem(`spotifree_yt_${key}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.videoId) {
        videoIdCache.set(key, parsed);
        return parsed;
      }
    }
  } catch (e) {}

  const cleanTitle = (title || '').replace(/[\(\[\{].*?[\)\]\}]/g, '').trim();
  const cleanArtist = (artist || '').replace(/[\(\[\{].*?[\)\]\}]/g, '').trim();

  const queries = [
    `${cleanTitle} ${cleanArtist}`.trim(),
    `${title} ${artist}`.trim(),
    cleanTitle
  ].filter(Boolean);

  // Strategy 1: Try Invidious with generous 7s timeout
  for (const q of queries) {
    for (const base of INVIDIOUS_INSTANCES) {
      try {
        const url = `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6500) });
        if (res.ok) {
          const items = await res.json();
          if (Array.isArray(items) && items.length > 0) {
            const valid = items.find(it => it.lengthSeconds >= 45 && it.lengthSeconds <= 900) || items[0];
            if (valid && valid.videoId) {
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
          }
        }
      } catch (err) {
        // Try next instance / query
      }
    }
  }

  // Strategy 2: Fallback via AllOrigins YouTube scraper
  try {
    const scrapeQuery = `${cleanTitle} ${cleanArtist}`.trim();
    const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(scrapeQuery)}`;
    const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(ytUrl)}`, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      const html = data?.contents || '';
      const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
      if (match && match[1]) {
        const result = {
          videoId: match[1],
          durationSeconds: 210,
          title: `${title} - ${artist}`,
          thumbnail: `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`
        };
        videoIdCache.set(key, result);
        try {
          localStorage.setItem(`spotifree_yt_${key}`, JSON.stringify(result));
        } catch (e) {}
        return result;
      }
    }
  } catch (e) {}

  return null;
}

/**
 * Searches tracks with instant client-side execution
 * Delivers FULL 3-5 minute tracks with videoId attached!
 */
export async function searchTracks(query, limit = 24) {
  if (!query || !query.trim()) return [];

  const q = query.trim();

  // 1. Primary: YouTube / Invidious Search (Hebrew, Pop, Remixes, Live, Underground)
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const url = `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6500) });
      if (res.ok) {
        const items = await res.json();
        if (Array.isArray(items) && items.length > 0) {
          // Filter out full albums/mixes (> 15 minutes) and snippets (< 40 seconds)
          const songs = items.filter(it => it.lengthSeconds >= 40 && it.lengthSeconds <= 900);
          const chosen = songs.length > 0 ? songs : items;

          return chosen.slice(0, limit).map(item => normalizeInvidiousTrack(item));
        }
      }
    } catch (e) {
      // Try next instance
    }
  }

  // 2. Secondary fallback: iTunes Search API (Ultra-crisp metadata, NO 30s previews)
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=${limit}`;
    const res = await fetch(itunesUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      const results = data.results || [];
      return results.map(item => normalizeItunesTrack(item));
    }
  } catch (e) {}

  return [];
}

/**
 * Normalizes Invidious / YouTube video to standard SpotiFree Track model
 */
function normalizeInvidiousTrack(item) {
  let title = item.title || 'Unknown Title';
  let artist = item.author || 'YouTube';

  // Clean title: "Artist - Title (Official Video)" -> Artist: Artist, Title: Title
  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    if (parts.length >= 2) {
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    }
  }

  // Clean trailing tags like [Official Music Video], (קליפ רשמי), etc.
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
 * NOTE: Preview URLs are deliberately excluded to prevent 30s cap!
 */
function normalizeItunesTrack(item) {
  let thumbnail = item.artworkUrl100 || '';
  if (thumbnail && thumbnail.includes('100x100bb.jpg')) {
    thumbnail = thumbnail.replace('100x100bb.jpg', '600x600bb.jpg');
  }

  const durationSeconds = Math.round((item.trackTimeMillis || 0) / 1000);

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
 * Curated trending hits for Home view (Hebrew & Global)
 */
export async function getTrendingTracks(limit = 18) {
  const trendingQueries = [
    'שירים ישראלים 2026',
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
 * Direct audio fallback resolver (Audius only, NEVER 30s previews)
 */
export async function getPlayableAudioUrl(track) {
  if (!track) throw new Error('No track provided');

  // Audius full stream fallback
  try {
    const audiusRes = await fetch(`https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(track.title + ' ' + (track.artist || ''))}&app_name=SpotiFree`);
    if (audiusRes.ok) {
      const audiusData = await audiusRes.json();
      const first = audiusData.data?.[0];
      if (first && first.id) {
        return `https://discoveryprovider.audius.co/v1/tracks/${first.id}/stream?app_name=SpotiFree`;
      }
    }
  } catch (e) {}

  return '';
}
