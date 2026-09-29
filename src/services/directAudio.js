// Direct Pure Audio Music Engine for SpotiFree V2
// 100% Free, ZERO Ads, True Mobile Background Playback, Full 3-5 Minute Songs!

const INVIDIOUS_INSTANCES = [
  'https://invidious.f5.si',
  'https://inv.nadeko.net',
  'https://iv.ggtyler.dev',
  'https://invidious.nerdvpn.de'
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

  // 1. Primary: YouTube / Invidious Search (Hebrew, Pop, Remixes, Live, Underground)
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const url = `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const items = await res.json();
        if (Array.isArray(items) && items.length > 0) {
          const songs = items.filter(it => it.lengthSeconds >= 40 && it.lengthSeconds <= 900);
          const chosen = songs.length > 0 ? songs : items;
          return chosen.slice(0, limit).map(item => normalizeInvidiousTrack(item));
        }
      }
    } catch (e) {}
  }

  // 2. Secondary fallback: iTunes Search API (Crisp metadata)
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
    for (const base of INVIDIOUS_INSTANCES) {
      try {
        const url = `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
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
      } catch (err) {}
    }
  }

  return null;
}

/**
 * Resolves a DIRECT, AD-FREE audio stream URL (MP4 / M4A / WebM / MP3)
 * Plays in pure HTML5 <audio> with zero ads and true background playback!
 */
export async function getPlayableAudioUrl(track) {
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

  // 2. Fetch direct audio stream URL from Invidious adaptive formats (0% ads, high bitrate AAC)
  if (videoId) {
    for (const base of INVIDIOUS_INSTANCES) {
      try {
        const res = await fetch(`${base}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(6500) });
        if (res.ok) {
          const data = await res.json();
          const audio = data.adaptiveFormats?.find(f => f.container === 'm4a' && f.url) ||
                        data.adaptiveFormats?.find(f => f.type?.includes('audio') && f.url);
          if (audio && audio.url) {
            audioStreamCache.set(track.id, {
              url: audio.url,
              expiresAt: Date.now() + 4 * 60 * 60 * 1000
            });
            return audio.url;
          }
        }
      } catch (e) {}
    }

    // 3. Fallback: Invidious direct audio stream endpoint
    const proxyStream = `https://invidious.f5.si/latest_version?id=${videoId}&itag=140`;
    audioStreamCache.set(track.id, { url: proxyStream, expiresAt: Date.now() + 2 * 60 * 60 * 1000 });
    return proxyStream;
  }

  // 4. Fallback: Audius full MP3 stream
  try {
    const audiusRes = await fetch(`https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(track.title + ' ' + (track.artist || ''))}&app_name=SpotiFree`, { signal: AbortSignal.timeout(4000) });
    if (audiusRes.ok) {
      const audiusData = await audiusRes.json();
      const first = audiusData.data?.[0];
      if (first && first.id) {
        const audiusUrl = `https://discoveryprovider.audius.co/v1/tracks/${first.id}/stream?app_name=SpotiFree`;
        audioStreamCache.set(track.id, { url: audiusUrl, expiresAt: Date.now() + 4 * 60 * 60 * 1000 });
        return audiusUrl;
      }
    }
  } catch (e) {}

  throw new Error('לא ניתן היה לטעון את קטע השמע. נא לנסות שיר אחר.');
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
