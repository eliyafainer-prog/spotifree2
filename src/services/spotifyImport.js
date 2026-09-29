// Client-Side Spotify & YouTube Playlist Importer with Strict Parsing & No Fake Fallbacks
import { searchTracks } from './directAudio.js';

/**
 * Parses any Spotify or YouTube URL and imports the playlist/tracks
 */
export async function importPlaylistFromUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('נא להזין קישור תקין');
  }

  const cleanUrl = url.trim();

  // 1. Try Spotify entity parsing & import
  if (cleanUrl.includes('spotify.com') || cleanUrl.includes('spotify:') || /[a-zA-Z0-9]{22}/.test(cleanUrl)) {
    return await importSpotifyPlaylist(cleanUrl);
  }

  // 2. Handle YouTube URL
  if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) {
    return importYouTubePlaylist(cleanUrl);
  }

  // 3. Fallback: Search tracks directly ONLY if user typed a plain search query (not a URL)
  if (!cleanUrl.includes('http') && !cleanUrl.includes('.com') && cleanUrl.length > 2) {
    const searchRes = await searchTracks(cleanUrl, 15);
    if (searchRes.length > 0) {
      return {
        id: `pl_search_${Date.now()}`,
        title: `פלייליסט: ${cleanUrl}`,
        cover: searchRes[0].thumbnail,
        type: 'Search Playlist',
        tracks: searchRes
      };
    }
  }

  throw new Error('לא הצלחנו לייבא את השירים מקישור זה. ודא שהקישור של הפלייליסט ב-Spotify תקין ושהפלייליסט מוגדר כציבורי (Public).');
}

/**
 * Helper to extract Spotify entity (type + 22-char base62 id)
 */
function extractSpotifyEntity(input) {
  if (!input) return null;
  const match = input.match(/(playlist|album|track)[:\/]([a-zA-Z0-9]{22})/i);
  if (match) {
    return { type: match[1].toLowerCase(), id: match[2] };
  }
  const truncatedMatch = input.match(/([a-zA-Z0-9]{22})/);
  if (truncatedMatch) {
    return { type: 'playlist', id: truncatedMatch[1] };
  }
  return null;
}

/**
 * Parse Spotify Embed HTML string into entity object
 */
function parseSpotifyEmbedHtml(html) {
  if (!html) return null;

  // Strategy 1: __NEXT_DATA__ JSON
  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (nextMatch && nextMatch[1]) {
    try {
      const nextData = JSON.parse(nextMatch[1]);
      const entity = nextData.props?.pageProps?.state?.data?.entity;
      if (entity) return entity;
    } catch (e) {}
  }

  // Strategy 2: Base64 JSON inside body script (resource or initial-state)
  const b64Matches = html.matchAll(/<script[^>]*>(.*?)<\/script>/gs);
  for (const m of b64Matches) {
    const content = m[1]?.trim();
    if (!content) continue;
    try {
      const decoded = atob(content);
      if (decoded.includes('"trackList"') || decoded.includes('"entity"')) {
        const parsed = JSON.parse(decoded);
        if (parsed?.data?.entity) return parsed.data.entity;
        if (parsed?.trackList) return parsed;
      }
    } catch (e) {}
  }

  return null;
}

/**
 * Import Spotify Playlist, Album or Track strictly without fake search fallbacks
 */
async function importSpotifyPlaylist(rawUrl) {
  const entity = extractSpotifyEntity(rawUrl);
  if (!entity || !entity.id) {
    throw new Error('לא נראית כתובת ספוטיפיי תקינה. נא להעתיק את הקישור המלא של הפלייליסט מספוטיפיי.');
  }

  const type = entity.type || 'playlist';
  const spotifyId = entity.id;
  const canonicalUrl = `https://open.spotify.com/${type}/${spotifyId}`;
  const embedUrl = `https://open.spotify.com/embed/${type}/${spotifyId}`;

  let title = type === 'album' ? 'אלבום מיובא' : 'פלייליסט ספוטיפיי';
  let cover = '';

  // 1. Try fetching oEmbed metadata
  try {
    const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`);
    if (oembedRes.ok) {
      const oembedData = await oembedRes.json();
      title = oembedData.title || title;
      cover = oembedData.thumbnail_url || cover;
    }
  } catch (e) {}

  // 2. Fetch Embed HTML (direct fetch + proxy fallbacks)
  let html = '';
  const fetchUrls = [
    embedUrl,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(embedUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(embedUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(embedUrl)}`
  ];

  for (const fetchUrl of fetchUrls) {
    try {
      const res = await fetch(fetchUrl);
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 500) {
          html = text;
          break;
        }
      }
    } catch (e) {}
  }

  const tracks = [];

  if (html) {
    const dataEntity = parseSpotifyEmbedHtml(html);

    if (dataEntity) {
      title = dataEntity.title || dataEntity.name || title;
      if (!cover && dataEntity.visualIdentity?.image?.[0]?.url) {
        cover = dataEntity.visualIdentity.image[0].url;
      }

      const trackList = dataEntity.trackList || (dataEntity.type === 'track' ? [dataEntity] : []);
      for (let i = 0; i < trackList.length; i++) {
        const item = trackList[i];
        const trackTitle = item.title || item.name;
        const artistName = item.subtitle || item.artists?.[0]?.name || (Array.isArray(item.artists) ? item.artists.map(a => a.name).join(', ') : 'Unknown Artist');

        if (trackTitle) {
          tracks.push({
            id: `sp_${item.uri?.replace('spotify:track:', '') || `${spotifyId}_${i}`}`,
            title: trackTitle,
            artist: artistName,
            thumbnail: cover,
            durationSeconds: Math.round((item.duration || 180000) / 1000),
            source: 'spotify'
          });
        }
      }
    }
  }

  // 3. Strict Check: NEVER return fake search results if tracks is 0
  if (tracks.length === 0) {
    throw new Error('לא הצלחנו לחלץ את השירים המקוריים מהפלייליסט. ודא שהפלייליסט ב-Spotify מוגדר כציבורי (Public) ושלא הועתק קישור מקוצר/פרטי.');
  }

  return {
    id: `pl_sp_${Date.now()}`,
    title,
    cover,
    type: type === 'album' ? 'Album' : 'Playlist',
    tracks
  };
}

/**
 * Import YouTube Playlist or Video
 */
async function importYouTubePlaylist(url) {
  const playlistMatch = url.match(/[?&]list=([^#&?]+)/);
  if (playlistMatch) {
    const playlistId = playlistMatch[1];
    const invidiousHosts = [
      'https://inv.nadeko.net',
      'https://invidious.nerdvpn.de',
      'https://vid.puffyan.us',
      'https://yt.artemislena.eu'
    ];

    for (const host of invidiousHosts) {
      try {
        const res = await fetch(`${host}/api/v1/playlists/${playlistId}`);
        if (res.ok) {
          const data = await res.json();
          const videos = data.videos || [];
          if (videos.length > 0) {
            return {
              id: `pl_yt_${Date.now()}`,
              title: data.title || 'פלייליסט יוטיוב',
              cover: videos[0]?.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${videos[0]?.videoId}/hqdefault.jpg`,
              type: 'YouTube Playlist',
              tracks: videos.map((v, i) => ({
                id: `yt_${v.videoId || i}`,
                title: v.title,
                artist: v.author || 'YouTube',
                thumbnail: v.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
                durationSeconds: v.lengthSeconds || 200,
                source: 'youtube'
              }))
            };
          }
        }
      } catch (e) {}
    }
  }

  // Single video fallback
  const videoMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^#&?]+)/);
  if (videoMatch) {
    const videoId = videoMatch[1];
    return {
      id: `pl_yt_${Date.now()}`,
      title: 'שיר מיוטיוב',
      cover: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      type: 'YouTube Video',
      tracks: [{
        id: `yt_${videoId}`,
        title: 'YouTube Track',
        artist: 'YouTube',
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        durationSeconds: 200,
        source: 'youtube'
      }]
    };
  }

  throw new Error('לא זוהה קישור תקין לפלייליסט או שיר מיוטיוב');
}

/**
 * Import Playlist from plain text list of song names
 */
export async function importPlaylistFromTextList(title, textList, onProgress) {
  const lines = textList
    .split('\n')
    .map(l => l.replace(/^\d+[\.\)\-:]\s*/, '').trim())
    .filter(l => l.length > 1);

  if (lines.length === 0) {
    throw new Error('נא להזין לפחות שם שיר אחד');
  }

  const foundTracks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (onProgress) onProgress(i + 1, lines.length, line);
    try {
      const results = await searchTracks(line, 1);
      if (results && results.length > 0) {
        foundTracks.push(results[0]);
      }
    } catch (e) {}
  }

  if (foundTracks.length === 0) {
    throw new Error('לא נמצאו קטעי שמע תואמים לשמות שהוזנו');
  }

  return {
    id: `pl_custom_${Date.now()}`,
    title: title.trim() || 'שירים שאני אוהב',
    cover: foundTracks[0]?.thumbnail || '',
    type: 'Custom Playlist',
    tracks: foundTracks
  };
}


