// Direct Pure Audio Music Engine for SpotiFree V2
// 100% Free, ZERO Ads, True Mobile Background Playback, Full 3-5 Minute Songs!

const INVIDIOUS_INSTANCES = [
  'https://invidious.f5.si',
  'https://invidious.protokolla.fi',
  'https://inv.riverside.rocks'
];

// In-memory cache for resolved audio stream URLs
const audioStreamCache = new Map();
const videoIdCache = new Map();

function getCacheKey(title, artist = '') {
  return `${(title || '').trim().toLowerCase()}:::${(artist || '').trim().toLowerCase()}`;
}

/**
 * Searches tracks with instant client-side execution
 */
export async function searchTracks(query, limit = 24) {
  if (!query || !query.trim()) return [];
  const q = query.trim();

  // 1. Primary: iTunes Search API for crisp, high-quality metadata
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
          const items = await res.json();
          if (!Array.isArray(items) || items.length === 0) throw new Error('Empty');
          return items;
        })
    );
    
    const items = await Promise.any(fetchPromises);
    // Strict filter: must have a videoId and not be a channel or playlist item
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
 * Resolves a high-quality YouTube videoId for any song
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

  const cleanTitle = (title || '').replace(/[\(\[\{].*?[\)\]\}]/g, '').trim();
  const cleanArtist = (artist || '').replace(/[\(\[\{].*?[\)\]\}]/g, '').trim();

  const queries = [
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
            const items = await res.json();
            if (!Array.isArray(items) || items.length === 0) throw new Error('Empty');
            return items;
          })
      );
      
      const items = await Promise.any(fetchPromises);
      const videoItems = items.filter(it => (it.type === 'video' || !it.type) && it.videoId);
      const valid = videoItems.find(it => it.lengthSeconds >= 45 && it.lengthSeconds <= 900) || videoItems[0];
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
    } catch (err) {
      console.warn(`Resolution failed for query: ${q}`);
    }
  }

  return null;
}

/**
 * Resolves a DIRECT, AD-FREE audio stream URL (MP4 / M4A / WebM / MP3)
 * Plays in pure HTML5 <audio> with zero ads and true background playback!
 */
export async function getPlayableAudioUrl(track, signal) {
  if (!track) throw new Error('No track provided');

  // Check in-memory cache
  if (audioStreamCache.has(track.id)) {
    const cached = audioStreamCache.get(track.id);
    if (cached.expiresAt > Date.now()) {
      return cached.url;
    }
  }

  // 1. Get videoId
  let videoId = track.videoId;
  if (!videoId && track.id?.startsWith('yt_')) {
    videoId = track.id.replace('yt_', '');
  }

  if (!videoId) {
    const resolved = await resolveYouTubeVideo(track.title, track.artist);
    if (resolved?.videoId) {
      videoId = resolved.videoId;
      if (resolved.durationSeconds && !track.durationSeconds) {
        track.durationSeconds = resolved.durationSeconds;
      }
    }
  }

  if (videoId) {
    // 2. Fetch direct audio stream URL from Invidious adaptive formats concurrently
    try {
      const fetchPromises = INVIDIOUS_INSTANCES.map(base =>
        fetch(`${base}/api/v1/videos/${videoId}`, { signal: signal || AbortSignal.timeout(7500) })
          .then(async res => {
            if (!res.ok) throw new Error('Not ok');
            const data = await res.json();
            const audio = data.adaptiveFormats?.find(f => f.container === 'm4a' && f.url) ||
                          data.adaptiveFormats?.find(f => f.type?.includes('audio') && f.url);
            if (audio && audio.url) return audio.url;
            throw new Error('No audio');
          })
      );
      
      const audioUrl = await Promise.any(fetchPromises);
      if (audioUrl) {
        audioStreamCache.set(track.id, {
          url: audioUrl,
          expiresAt: Date.now() + 4 * 60 * 60 * 1000
        });
        return audioUrl;
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      console.warn('Concurrent fetch for audio streams failed', e);
    }

    // 3. Fallback: Invidious direct audio stream endpoint
    try {
      const randomInstance = INVIDIOUS_INSTANCES[Math.floor(Math.random() * INVIDIOUS_INSTANCES.length)];
      const proxyStream = `${randomInstance}/latest_version?id=${videoId}&itag=140`;
      audioStreamCache.set(track.id, { url: proxyStream, expiresAt: Date.now() + 2 * 60 * 60 * 1000 });
      return proxyStream;
    } catch (e) {}
  }

  // 4. Fallback for mobile cellular networks outside the house (direct Apple/Spotify CDN stream)
  const directPreview = track.rawTrack?.previewUrl || track.audioPreview?.url;
  if (directPreview) {
    audioStreamCache.set(track.id, { url: directPreview, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    return directPreview;
  }

  // 5. Fallback: Audius full stream
  try {
    const audiusRes = await fetch(`https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(track.title + ' ' + (track.artist || ''))}&app_name=SpotiFree`, { signal: signal || AbortSignal.timeout(4000) });
    if (audiusRes.ok) {
      const audiusData = await audiusRes.json();
      const first = audiusData.data?.[0];
      if (first && first.id) {
        const audiusUrl = `https://discoveryprovider.audius.co/v1/tracks/${first.id}/stream?app_name=SpotiFree`;
        audioStreamCache.set(track.id, { url: audiusUrl, expiresAt: Date.now() + 4 * 60 * 60 * 1000 });
        return audiusUrl;
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') throw e;
  }

  throw new Error('לא ניתן היה לטעון את קטע השמע. נא לבדוק חיבור אינטרנט.');
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
 * Curated trending hits for Home view
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
