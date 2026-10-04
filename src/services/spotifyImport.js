// AI-Powered Spotify & YouTube Playlist Importer for SpotiFree V2
// 100% Client-Side, Zero Login Required, Automatic Track Extraction via AI Reader & iTunes HD Enrichment

import { searchTracks } from './directAudio.js';

/**
 * Parses any Spotify or YouTube URL and imports the playlist/tracks automatically
 */
export async function importPlaylistFromUrl(url, onProgress) {
  if (!url || typeof url !== 'string') {
    throw new Error('נא להזין קישור תקין');
  }

  const cleanUrl = url.trim();

  // 1. Handle Spotify URL
  if (cleanUrl.includes('spotify.com') || cleanUrl.includes('spotify:') || /[a-zA-Z0-9]{22}/.test(cleanUrl)) {
    return await importSpotifyPlaylist(cleanUrl, onProgress);
  }

  // 2. Handle YouTube URL
  if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) {
    return await importYouTubePlaylist(cleanUrl);
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

  throw new Error('לא זוהה קישור תקין. ודא שהקישור של הפלייליסט מספוטיפיי או מיוטיוב ציבורי ותקין.');
}

/**
 * Extracts Spotify entity (type + 22-char base62 id)
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
 * Enriches tracks concurrently with official iTunes metadata:
 * - High-resolution 600x600 HD artwork for every single track
 * - Pristine 256kbps audio previewUrl (Apple CDN, open CORS, works 100% on cellular and mobile)
 * - Exact official song duration
 * - Official album and artist title
 */
export async function enrichTracksWithItunes(rawTracks, onProgress) {
  const chunkSize = 5;
  const enriched = [];

  for (let i = 0; i < rawTracks.length; i += chunkSize) {
    const chunk = rawTracks.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map(async (t, chunkIdx) => {
        const globalIdx = i + chunkIdx;
        if (onProgress) {
          onProgress(globalIdx + 1, rawTracks.length, t.title);
        }

        try {
          const cleanTitle = (t.title || '')
            .replace(/[\(\[\{].*?[\)\]\}]/g, '')
            .replace(/\s+-\s+Single$/i, '')
            .trim();
          const cleanArtist = (t.artist || '')
            .replace(/,/g, ' ')
            .split('&')[0]
            .trim();

          const query = encodeURIComponent(`${cleanTitle} ${cleanArtist}`.trim() || t.title);
          const res = await fetch(`https://itunes.apple.com/search?term=${query}&media=music&entity=song&limit=1`, {
            signal: AbortSignal.timeout(3500)
          });

          if (res.ok) {
            const data = await res.json();
            const match = data.results?.[0];
            if (match) {
              let thumb = match.artworkUrl100 || '';
              if (thumb.includes('100x100bb.jpg')) {
                thumb = thumb.replace('100x100bb.jpg', '600x600bb.jpg');
              }
              const durationSeconds = Math.round(match.trackTimeMillis / 1000) || t.durationSeconds;
              return {
                id: t.id || `sp_track_${globalIdx}_${Date.now()}`,
                title: match.trackName || t.title,
                artist: match.artistName || t.artist,
                album: match.collectionName || '',
                thumbnail: thumb || t.thumbnail,
                durationSeconds,
                previewUrl: match.previewUrl || '',
                source: 'spotify',
                rawTrack: match
              };
            }
          }
        } catch (e) {
          console.warn('iTunes enrichment failed for:', t.title, e);
        }

        return {
          id: t.id || `sp_track_${globalIdx}_${Date.now()}`,
          title: t.title,
          artist: t.artist,
          thumbnail: t.thumbnail || '',
          durationSeconds: t.durationSeconds || 210,
          previewUrl: '',
          source: 'spotify'
        };
      })
    );

    enriched.push(...chunkResults);
  }

  return enriched;
}

/**
 * Import Spotify Playlist, Album or Track automatically using AI Reader & HD Enrichment
 */
async function importSpotifyPlaylist(rawUrl, onProgress) {
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

  // 1. Fetch official Spotify Title and HD Cover Art via oEmbed (always works with open CORS)
  try {
    const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`, {
      signal: AbortSignal.timeout(6000)
    });
    if (oembedRes.ok) {
      const oembedData = await oembedRes.json();
      title = oembedData.title || title;
      cover = oembedData.thumbnail_url || cover;
    }
  } catch (e) {
    console.warn('oEmbed fetch warning:', e);
  }

  const rawTracks = [];

  // 2. PRIMARY STRATEGY: Jina AI Web Reader (Extracts all songs, artists, and durations automatically)
  try {
    if (onProgress) onProgress(0, 0, 'מפענח את הפלייליסט באמצעות AI Reader...');
    const jinaUrl = `https://r.jina.ai/${embedUrl}`;
    const jinaRes = await fetch(jinaUrl, {
      signal: AbortSignal.timeout(15000)
    });

    if (jinaRes.ok) {
      const text = await jinaRes.text();
      // Match blocks like:
      // 1.   ### Patient Zero
      // #### Taylor Swift
      // 03:45
      const blockRegex = /(?:^|\n)(?:\d+[\.\)]\s+)?###\s+([^\n]+)\n+####\s+(?:E\s+)?([^\n]+)(?:\n+(\d{1,2}:\d{2}))?/g;
      let match;
      while ((match = blockRegex.exec(text)) !== null) {
        const trackTitle = match[1].trim();
        const artist = match[2].trim();
        let durationSeconds = 210;
        if (match[3]) {
          const [min, sec] = match[3].split(':').map(Number);
          durationSeconds = min * 60 + sec;
        }

        rawTracks.push({
          id: `sp_${spotifyId}_${rawTracks.length}`,
          title: trackTitle,
          artist: artist,
          thumbnail: cover || '',
          durationSeconds: durationSeconds || 210,
          source: 'spotify'
        });
      }
    }
  } catch (err) {
    console.warn('Jina AI extraction warning:', err);
  }

  // 3. Single track fallback
  if (rawTracks.length === 0 && type === 'track') {
    rawTracks.push({
      id: `sp_${spotifyId}`,
      title: title || 'שיר מספוטיפיי',
      artist: 'Spotify Artist',
      thumbnail: cover,
      durationSeconds: 210,
      source: 'spotify'
    });
  }

  if (rawTracks.length === 0) {
    throw new Error('לא הצלחנו לקרוא את השירים מהפלייליסט. ודא שהפלייליסט בספוטיפיי מוגדר כציבורי (Public).');
  }

  // 4. Enrich every track with 600x600 HD artwork and direct Apple CDN audio stream
  if (onProgress) onProgress(0, rawTracks.length, 'מתאים עטיפות HD 600x600 וקובצי שמע...');
  const enrichedTracks = await enrichTracksWithItunes(rawTracks, onProgress);

  // If playlist cover was empty or low-res, use the first song's HD cover
  if (!cover && enrichedTracks.length > 0 && enrichedTracks[0].thumbnail) {
    cover = enrichedTracks[0].thumbnail;
  }

  return {
    id: `pl_sp_${Date.now()}`,
    title,
    cover,
    type: type === 'album' ? 'Album' : 'Playlist',
    tracks: enrichedTracks
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
      'https://invidious.f5.si',
      'https://invidious.nerdvpn.de',
      'https://inv.nadeko.net'
    ];

    for (const host of invidiousHosts) {
      try {
        const res = await fetch(`${host}/api/v1/playlists/${playlistId}`, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('json')) {
            const data = await res.json();
            const videos = (data.videos || []).filter(v => v.videoId);
            if (videos.length > 0) {
              const rawTracks = videos.map((v, i) => ({
                id: `yt_${v.videoId || i}`,
                videoId: v.videoId,
                title: v.title,
                artist: v.author || 'YouTube',
                thumbnail: v.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
                durationSeconds: v.lengthSeconds || 200,
                source: 'youtube'
              }));

              const enriched = await enrichTracksWithItunes(rawTracks);

              return {
                id: `pl_yt_${Date.now()}`,
                title: data.title || 'פלייליסט יוטיוב',
                cover: enriched[0]?.thumbnail || `https://i.ytimg.com/vi/${videos[0]?.videoId}/hqdefault.jpg`,
                type: 'YouTube Playlist',
                tracks: enriched
              };
            }
          }
        }
      } catch (e) {}
    }
  }

  // Single video fallback
  const videoMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^#&?]+)/);
  if (videoMatch) {
    const videoId = videoMatch[1];
    const singleRaw = [{
      id: `yt_${videoId}`,
      videoId,
      title: 'YouTube Track',
      artist: 'YouTube',
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      durationSeconds: 200,
      source: 'youtube'
    }];
    const enriched = await enrichTracksWithItunes(singleRaw);
    return {
      id: `pl_yt_${Date.now()}`,
      title: enriched[0]?.title || 'שיר מיוטיוב',
      cover: enriched[0]?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      type: 'YouTube Video',
      tracks: enriched
    };
  }

  throw new Error('לא זוהה קישור תקין לפלייליסט או שיר מיוטיוב');
}

/**
 * Text Playlist Importer (Legacy / direct search)
 */
export async function importPlaylistFromTextList(title, textList, onProgress) {
  const rawLines = textList
    .split(/[\n;]+/)
    .map(l => l.trim())
    .filter(l => l.length > 1);

  if (rawLines.length === 0) {
    throw new Error('נא להזין לפחות שם שיר אחד או קישור');
  }

  const rawTracks = rawLines.map((line, idx) => {
    let t = line.replace(/^[\d]+[\.\)\-:\s]+/, '').trim();
    let artist = '';
    if (t.includes(' - ')) {
      const parts = t.split(' - ');
      artist = parts[0].trim();
      t = parts.slice(1).join(' - ').trim();
    }
    return {
      id: `custom_${idx}_${Date.now()}`,
      title: t,
      artist: artist,
      durationSeconds: 210,
      source: 'custom'
    };
  });

  const enriched = await enrichTracksWithItunes(rawTracks, onProgress);

  return {
    id: `pl_custom_${Date.now()}`,
    title: title.trim() || 'פלייליסט מיובא',
    cover: enriched[0]?.thumbnail || '',
    type: 'Custom Playlist',
    tracks: enriched
  };
}
