// Direct Music Search & Audio Engine for SpotiFree V2
// Delivers FULL 3-5 minute songs, ZERO 30s previews, 100% free with background playback!

const INVIDIOUS_INSTANCES = [
  'https://invidious.f5.si',
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net'
];

// In-memory cache for resolved video IDs
const videoIdCache = new Map();

function getCacheKey(title, artist = '') {
  return `${(title || '').trim().toLowerCase()}:::${(artist || '').trim().toLowerCase()}`;
}

/**
 * Smart ranking algorithm to choose the cleanest, ad-free audio stream:
 * Prefers YouTube Music Official Audio / Topic / Lyrics over heavy video clips
 */
function rankVideo(item) {
  let score = 0;
  const title = (item.title || '').toLowerCase();
  const author = (item.author || '').toLowerCase();

  // Prefer clean audio / official topic / lyrics over video clips to minimize video ads
  if (author.includes('topic')) score += 60;
  if (title.includes('audio') || title.includes('אודיו')) score += 50;
  if (title.includes('lyrics') || title.includes('מילים')) score += 35;
  if (!title.includes('קליפ') && !title.includes('official music video') && !title.includes('official video')) score += 40;

  // Duration sanity check: typical songs are between 90s and 450s (not 30s snippets, not 1-hour mixes)
  if (item.lengthSeconds >= 90 && item.lengthSeconds <= 450) score += 30;

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
    const fetchPromises = INVIDIOUS_INSTANCES.map(base =>
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
    const songs = videoItems.filter(it => it.lengthSeconds >= 40 && it.lengthSeconds <= 900);
    const chosen = songs.length > 0 ? songs : videoItems;
    return chosen.slice(0, limit).map(item => normalizeInvidiousTrack(item));
  } catch (e) {
    console.warn('Invidious search failed:', e);
  }

  return [];
}

/**
 * Resolves a high-quality, FULL-LENGTH YouTube videoId for any song (title + artist)
 * Prefers clean Audio / Topic tracks with zero ads!
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
    `${cleanTitle} ${cleanArtist} Audio`.trim(),
    `${cleanTitle} ${cleanArtist}`.trim(),
    `${title} ${artist}`.trim(),
    cleanTitle
  ].filter(Boolean);

  for (const q of queries) {
    try {
      const fetchPromises = INVIDIOUS_INSTANCES.map(base =>
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
      const videoItems = items.filter(it => (it.type === 'video' || !it.type) && it.videoId && it.lengthSeconds >= 45 && it.lengthSeconds <= 900);
      
      if (videoItems.length > 0) {
        videoItems.sort((a, b) => rankVideo(b) - rankVideo(a));
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
    } catch (err) {
      // Try next query
    }
  }

  return null;
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
 * Resolves a playable audio URL (used for downloading tracks offline)
 */
export async function getPlayableAudioUrl(track) {
  if (!track) throw new Error('No track provided');

  let videoId = track.videoId;
  if (!videoId && track.id?.startsWith('yt_')) {
    videoId = track.id.replace('yt_', '');
  }
  if (!videoId) {
    const resolved = await resolveYouTubeVideo(track.title, track.artist);
    if (resolved?.videoId) videoId = resolved.videoId;
  }

  if (videoId) {
    for (const base of INVIDIOUS_INSTANCES) {
      try {
        const streamUrl = `${base}/latest_version?id=${videoId}&itag=140`;
        return streamUrl;
      } catch (e) {}
    }
  }

  // Fallback: Audius
  try {
    const audiusRes = await fetch(`https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(track.title + ' ' + (track.artist || ''))}&app_name=SpotiFree`);
    if (audiusRes.ok) {
      const d = await audiusRes.json();
      const first = d.data?.[0];
      if (first?.id) {
        return `https://discoveryprovider.audius.co/v1/tracks/${first.id}/stream?app_name=SpotiFree`;
      }
    }
  } catch (e) {}

  throw new Error('לא נמצא מקור שמע זמין להורדה');
}

