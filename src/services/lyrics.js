// Real-time Synced Karaoke Lyrics Service (LRCLIB API)

const lyricsCache = new Map();

/**
 * Parses LRC timestamp string format: "[00:15.30] lyrics text"
 */
export function parseLrcLyrics(lrcString) {
  if (!lrcString || typeof lrcString !== 'string') return [];

  const lines = lrcString.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.?(\d{0,3})\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const matches = [...trimmed.matchAll(timeRegex)];
    if (matches.length > 0) {
      const text = trimmed.replace(timeRegex, '').trim();
      for (const match of matches) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const millis = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0;
        const totalSeconds = minutes * 60 + seconds + millis / 1000;

        result.push({
          time: totalSeconds,
          text: text
        });
      }
    }
  }

  // Sort chronologically
  return result.sort((a, b) => a.time - b.time);
}

/**
 * Fetch lyrics from LRCLIB API with automatic clean-up and fallback
 */
export async function getLyrics(title, artist, durationSeconds = 0) {
  if (!title) return { synced: [], plain: [], hasSynced: false };

  // Clean title: remove "feat.", "(official audio)", etc.
  const cleanTitle = title
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/feat\..*$/i, '')
    .replace(/ft\..*$/i, '')
    .trim();

  const cleanArtist = (artist || '')
    .replace(/feat\..*$/i, '')
    .replace(/ft\..*$/i, '')
    .trim();

  const cacheKey = `${cleanArtist}:::${cleanTitle}`.toLowerCase();
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey);
  }

  try {
    let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}`;
    if (cleanArtist && cleanArtist !== 'Unknown Artist') {
      url += `&artist_name=${encodeURIComponent(cleanArtist)}`;
    }
    if (durationSeconds > 0) {
      url += `&duration=${Math.round(durationSeconds)}`;
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      const data = await res.json();
      const parsedSynced = data.syncedLyrics ? parseLrcLyrics(data.syncedLyrics) : [];
      const plainLines = data.plainLyrics ? data.plainLyrics.split('\n').filter(Boolean) : [];

      const result = {
        synced: parsedSynced,
        plain: plainLines,
        hasSynced: parsedSynced.length > 0
      };

      lyricsCache.set(cacheKey, result);
      return result;
    }
  } catch (err) {
    // If exact match failed, try search endpoint
    try {
      const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle + ' ' + cleanArtist)}`, {
        signal: AbortSignal.timeout(3000)
      });
      if (searchRes.ok) {
        const results = await searchRes.json();
        if (results && results.length > 0) {
          const best = results[0];
          const parsedSynced = best.syncedLyrics ? parseLrcLyrics(best.syncedLyrics) : [];
          const plainLines = best.plainLyrics ? best.plainLyrics.split('\n').filter(Boolean) : [];

          const result = {
            synced: parsedSynced,
            plain: plainLines,
            hasSynced: parsedSynced.length > 0
          };

          lyricsCache.set(cacheKey, result);
          return result;
        }
      }
    } catch (e) {}
  }

  return { synced: [], plain: [], hasSynced: false };
}
