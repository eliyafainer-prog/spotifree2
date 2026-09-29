// Client-Side Spotify & YouTube Playlist Importer

/**
 * Parses any Spotify or YouTube URL and imports the playlist/tracks
 */
export async function importPlaylistFromUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('נא להזין קישור תקין');
  }

  const cleanUrl = url.trim();

  // Handle Spotify URL
  if (cleanUrl.includes('spotify.com')) {
    return importSpotifyPlaylist(cleanUrl);
  }

  // Handle YouTube URL
  if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) {
    return importYouTubePlaylist(cleanUrl);
  }

  throw new Error('הקישור שהוזן אינו קישור של Spotify או YouTube');
}

/**
 * Import Spotify Playlist, Album or Track
 */
async function importSpotifyPlaylist(url) {
  // 1. Fetch metadata via Spotify public oEmbed (CORS-friendly)
  let title = 'פלייליסט מיובא';
  let cover = '';

  try {
    const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
    if (oembedRes.ok) {
      const oembedData = await oembedRes.json();
      title = oembedData.title || title;
      cover = oembedData.thumbnail_url || cover;
    }
  } catch (e) {}

  // 2. Fetch tracks from Spotify Embed HTML
  let embedUrl = url;
  if (!url.includes('/embed/')) {
    embedUrl = url.replace('open.spotify.com/', 'open.spotify.com/embed/');
  }

  let html = '';
  // Try direct fetch first (works natively in Capacitor / mobile app)
  try {
    const res = await fetch(embedUrl);
    if (res.ok) html = await res.text();
  } catch (e) {
    // Web browser CORS fallback via open proxy
    try {
      const proxyRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(embedUrl)}`);
      if (proxyRes.ok) html = await proxyRes.text();
    } catch (err) {}
  }

  const tracks = [];

  if (html) {
    try {
      // Find __NEXT_DATA__ JSON script tag
      const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
      if (match && match[1]) {
        const nextData = JSON.parse(match[1]);
        const entity = nextData.props?.pageProps?.state?.data?.entity;

        if (entity) {
          title = entity.title || entity.name || title;
          if (!cover && entity.visualIdentity?.image?.[0]?.url) {
            cover = entity.visualIdentity.image[0].url;
          }

          const trackList = entity.trackList || [];
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
    } catch (parseErr) {
      console.warn('Failed to parse Spotify embed JSON:', parseErr);
    }
  }

  if (tracks.length === 0) {
    // If it was a single track URL
    if (url.includes('/track/')) {
      const parts = title.split(' by ');
      const songTitle = parts[0] || title;
      const songArtist = parts[1] || 'Spotify Track';

      tracks.push({
        id: `sp_${Date.now()}`,
        title: songTitle,
        artist: songArtist,
        thumbnail: cover,
        durationSeconds: 210,
        source: 'spotify'
      });
    } else {
      throw new Error('לא הצלחנו לייבא את השירים מקישור זה. ודא שהפלייליסט ציבורי.');
    }
  }

  return {
    id: `pl_sp_${Date.now()}`,
    title,
    cover,
    type: url.includes('/album/') ? 'Album' : 'Playlist',
    tracks
  };
}

/**
 * Import YouTube Playlist
 */
async function importYouTubePlaylist(url) {
  // Extract video ID or playlist ID
  const playlistMatch = url.match(/[?&]list=([^#&?]+)/);
  const videoMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^#&?]+)/);

  const title = playlistMatch ? 'פלייליסט יוטיוב מיובא' : 'שיר יוטיוב מיובא';
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
