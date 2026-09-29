// Client-Side Spotify & YouTube Playlist Importer with Smart URL Normalization & Fallbacks
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
    try {
      return await importSpotifyPlaylist(cleanUrl);
    } catch (err) {
      console.warn('Spotify import attempt 1 failed:', err);
      // Fallback search by query if input was text or title
      if (!cleanUrl.includes('http') && cleanUrl.length > 2) {
        const searchRes = await searchTracks(cleanUrl, 15);
        if (searchRes.length > 0) {
          return {
            id: `pl_search_${Date.now()}`,
            title: `פלייליסט: ${cleanUrl}`,
            cover: searchRes[0].thumbnail,
            type: 'Custom Playlist',
            tracks: searchRes
          };
        }
      }
      throw err;
    }
  }

  // 2. Handle YouTube URL
  if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) {
    return importYouTubePlaylist(cleanUrl);
  }

  // 3. Fallback: Search tracks directly by query string
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

  throw new Error('לא הצלחנו לייבא את השירים מקישור זה. ודא שהקישור של הפלייליסט ב-Spotify מוגדר כציבורי (Public).');
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
 * Import Spotify Playlist, Album or Track
 */
async function importSpotifyPlaylist(rawUrl) {
  const entity = extractSpotifyEntity(rawUrl);
  const type = entity?.type || 'playlist';
  const spotifyId = entity?.id;

  const canonicalUrl = spotifyId
    ? `https://open.spotify.com/${type}/${spotifyId}`
    : rawUrl;

  let title = type === 'album' ? 'אלבום מיובא' : 'פלייליסט ספוטיפיי';
  let cover = '';

  // 1. Fetch metadata via Spotify oEmbed
  try {
    const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`);
    if (oembedRes.ok) {
      const oembedData = await oembedRes.json();
      title = oembedData.title || title;
      cover = oembedData.thumbnail_url || cover;
    }
  } catch (e) {}

  // 2. Fetch Embed Page HTML
  const embedUrl = `https://open.spotify.com/embed/${type}/${spotifyId || ''}`;
  let html = '';
  try {
    const res = await fetch(embedUrl);
    if (res.ok) html = await res.text();
  } catch (e) {
    try {
      const proxyRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(embedUrl)}`);
      if (proxyRes.ok) html = await proxyRes.text();
    } catch (err) {}
  }

  const tracks = [];

  if (html) {
    try {
      const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
      if (match && match[1]) {
        const nextData = JSON.parse(match[1]);
        const dataEntity = nextData.props?.pageProps?.state?.data?.entity;

        if (dataEntity) {
          title = dataEntity.title || dataEntity.name || title;
          if (!cover && dataEntity.visualIdentity?.image?.[0]?.url) {
            cover = dataEntity.visualIdentity.image[0].url;
          }

          const trackList = dataEntity.trackList || [];
          for (let i = 0; i < trackList.length; i++) {
            const item = trackList[i];
            tracks.push({
              id: `sp_${item.uri?.replace('spotify:track:', '') || i}`,
              title: item.title || item.name || 'Unknown Title',
              artist: item.subtitle || item.artists?.[0]?.name || 'Unknown Artist',
              thumbnail: cover,
              durationSeconds: Math.round((item.duration || 180000) / 1000),
              source: 'spotify'
            });
          }
        }
      }
    } catch (parseErr) {}
  }

  // 3. Fallback: Search iTunes/SoundCloud by playlist title if tracks list is empty
  if (tracks.length === 0) {
    if (title && title !== 'פלייליסט ספוטיפיי' && title !== 'אלבום מיובא') {
      const searchRes = await searchTracks(title, 15);
      if (searchRes.length > 0) {
        return {
          id: `pl_sp_${Date.now()}`,
          title,
          cover: cover || searchRes[0].thumbnail,
          type: 'Imported Playlist',
          tracks: searchRes
        };
      }
    }

    throw new Error('לא הצלחנו לייבא את השירים מקישור זה. ודא שהקישור של הפלייליסט ב-Spotify מוגדר כציבורי (Public).');
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
 * Import YouTube Playlist
 */
async function importYouTubePlaylist(url) {
  const videoMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^#&?]+)/);
  const title = 'פלייליסט יוטיוב';
  const cover = '';

  const tracks = [];
  if (videoMatch) {
    const videoId = videoMatch[1];
    tracks.push({
      id: `yt_${videoId}`,
      title: 'YouTube Track',
      artist: 'YouTube',
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      durationSeconds: 200,
      source: 'youtube'
    });
  }

  return {
    id: `pl_yt_${Date.now()}`,
    title,
    cover,
    type: 'YouTube Playlist',
    tracks
  };
}
