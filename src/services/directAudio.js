// Direct Client-Side Music Engine (Zero PC server needed, FULL 3-5 Minute Songs!)

const SOUNDCLOUD_CLIENT_IDS = [
  'pmagYZKQF6mRtNmtRzPkXSQJ76jYHLN8',
  'iZIs9mchVcX5lhVRdekQWmUAUISRa1M7',
  '2t9loNIXhm00JUXYzzyxdqoXOEQNYqoq',
  'a3dd183dc579bc1485acf84e2aa72e3b'
];

let activeClientId = SOUNDCLOUD_CLIENT_IDS[0];

// In-memory cache for resolved stream URLs
const streamUrlCache = new Map();

/**
 * Gets base SC search API endpoint (uses /api-sc proxy on Vite or direct/CORS proxy)
 */
function getScApiUrl(path) {
  if (typeof window !== 'undefined') {
    if (window.Capacitor?.isNativePlatform?.()) {
      return `https://api-v2.soundcloud.com${path}`;
    }
    // Works on Localhost and Cloud Deployments (Vercel / Netlify / Render)
    return `/api-sc${path}`;
  }
  return `https://api-v2.soundcloud.com${path}`;
}

/**
 * Search tracks with instant client-side execution (filters out 30s previews for FULL songs)
 */
export async function searchTracks(query, limit = 24) {
  if (!query || !query.trim()) return [];

  const q = query.trim();
  const clientId = activeClientId;

  // 1. Try SoundCloud API (with duration > 45s filter for FULL 3-5 min songs)
  try {
    const apiPath = `/search/tracks?q=${encodeURIComponent(q)}&client_id=${clientId}&limit=${limit * 2}`;
    const url = getScApiUrl(apiPath);
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const items = data.collection || [];
      
      // Filter out 30s previews (duration <= 45000ms) to ensure full songs
      const fullSongs = items.filter(item => item && item.id && item.title && item.duration && item.duration > 45000);
      const chosenItems = fullSongs.length > 0 ? fullSongs : items.filter(item => item && item.id && item.title);

      if (chosenItems.length > 0) {
        return chosenItems.slice(0, limit).map(item => normalizeScTrack(item));
      }
    }
  } catch (err) {
    console.warn('SC search error:', err);
  }

  // 2. Fallback to iTunes API
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=${limit}`;
    const res = await fetch(itunesUrl);
    if (res.ok) {
      const data = await res.json();
      return (data.results || []).map(item => normalizeItunesTrack(item));
    }
  } catch (e) {}

  return [];
}

/**
 * Get popular trending tracks for the Home screen (FULL length 3-5 min tracks)
 */
export async function getTrendingTracks(limit = 18) {
  const trendingQueries = ['עומר אדם', 'Coldplay', 'עדן חסון', 'אושר כהן', 'Pop Hits 2026', 'Top Hits'];
  const randomQuery = trendingQueries[Math.floor(Math.random() * trendingQueries.length)];
  return searchTracks(randomQuery, limit);
}

/**
 * Resolves a direct, high-quality FULL audio stream URL (MP3/AAC from CDN)
 */
export async function getPlayableAudioUrl(track) {
  if (!track) throw new Error('No track provided');

  // Check in-memory cache
  if (streamUrlCache.has(track.id)) {
    const cached = streamUrlCache.get(track.id);
    if (cached.expiresAt > Date.now()) {
      return cached.url;
    }
    streamUrlCache.delete(track.id);
  }

  const clientId = activeClientId;

  // If track is a SoundCloud track with transcodings
  let transcodings = track.rawTrack?.media?.transcodings;

  if (!transcodings && track.source === 'soundcloud' && track.rawTrack?.id) {
    try {
      const trackUrl = getScApiUrl(`/tracks/${track.rawTrack.id}?client_id=${clientId}`);
      const res = await fetch(trackUrl);
      if (res.ok) {
        const fullTrack = await res.json();
        transcodings = fullTrack.media?.transcodings;
      }
    } catch (e) {}
  }

  // If we don't have transcodings (e.g. from iTunes or imported), search SC by title + artist for full track
  if (!transcodings || transcodings.length === 0) {
    const searchRes = await searchTracks(`${track.title} ${track.artist || ''}`, 3);
    if (searchRes.length > 0 && searchRes[0].rawTrack?.media?.transcodings) {
      transcodings = searchRes[0].rawTrack.media.transcodings;
    }
  }

  if (transcodings && transcodings.length > 0) {
    const progressive = transcodings.find(t => t.format?.protocol === 'progressive' && !t.snipped) ||
                        transcodings.find(t => t.format?.protocol === 'progressive');
    const chosen = progressive || transcodings[0];

    if (chosen && chosen.url) {
      const mediaPath = chosen.url.replace('https://api-v2.soundcloud.com', '');
      const streamEndpoint = getScApiUrl(`${mediaPath}?client_id=${clientId}`);
      const streamRes = await fetch(streamEndpoint);
      if (streamRes.ok) {
        const streamData = await streamRes.json();
        if (streamData && streamData.url) {
          streamUrlCache.set(track.id, {
            url: streamData.url,
            expiresAt: Date.now() + 4 * 60 * 60 * 1000
          });
          return streamData.url;
        }
      }
    }
  }

  // Fallback: Audius full stream
  try {
    const audiusRes = await fetch(`https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(track.title + ' ' + (track.artist || ''))}&app_name=SpotiFree`);
    if (audiusRes.ok) {
      const audiusData = await audiusRes.json();
      const first = audiusData.data?.[0];
      if (first && first.id) {
        const audiusStream = `https://discoveryprovider.audius.co/v1/tracks/${first.id}/stream?app_name=SpotiFree`;
        streamUrlCache.set(track.id, { url: audiusStream, expiresAt: Date.now() + 4 * 60 * 60 * 1000 });
        return audiusStream;
      }
    }
  } catch (e) {}

  // Fallback: previewUrl
  if (track.previewUrl) {
    return track.previewUrl;
  }

  throw new Error('Could not resolve full audio stream');
}

/**
 * Normalizes raw SoundCloud track data to a unified SpotiFree track model
 */
function normalizeScTrack(item) {
  let artist = item.user?.username || 'Unknown Artist';
  let title = item.title || 'Unknown Title';

  if (title.includes(' - ')) {
    const parts = title.split(' - ');
    if (parts.length >= 2) {
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    }
  }

  let thumbnail = item.artwork_url || item.user?.avatar_url || '';
  if (thumbnail && thumbnail.includes('-large.')) {
    thumbnail = thumbnail.replace('-large.', '-t500x500.');
  }

  const durationSeconds = Math.round((item.duration || 0) / 1000);

  return {
    id: `sc_${item.id}`,
    title,
    artist,
    thumbnail,
    durationSeconds,
    source: 'soundcloud',
    rawTrack: item
  };
}

/**
 * Normalizes raw iTunes track data
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
    previewUrl: item.previewUrl || '',
    source: 'itunes',
    rawTrack: item
  };
}

export async function getActiveClientId() {
  return activeClientId;
}
