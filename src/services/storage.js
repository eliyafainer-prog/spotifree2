const LIKED_SONGS_KEY = 'spotifree_liked_songs';
const PLAYLISTS_KEY = 'spotifree_playlists';
const RECENT_KEY = 'spotifree_recent_tracks';

export const BUILTIN_PLAYLIST_SONGS_I_LOVE = {
  id: 'pl_songs_i_love_default',
  title: 'שירים שאני אוהב',
  description: 'פלייליסט מובנה מומלץ',
  type: 'Custom Playlist',
  cover: 'https://i1.sndcdn.com/artworks-000337714776-o15als-t500x500.jpg',
  createdAt: 1700000000000,
  tracks: [
    {
      id: 'sc_1959344591',
      title: 'הכל וכלום בבת אחת - עומר אדם',
      artist: 'ORIN MORDECHAI',
      thumbnail: 'https://i1.sndcdn.com/artworks-eTf2i0B0XjA7T3g3-CkhVpQ-t500x500.jpg',
      durationSeconds: 202,
      source: 'soundcloud'
    },
    {
      id: 'itunes_icona_pop',
      title: 'THIS IS... ICONA POP',
      artist: 'Icona Pop',
      thumbnail: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/31/3e/6a/313e6a0d-31eb-1598-a579-246e451152a8/825646399672.jpg/600x600bb.jpg',
      durationSeconds: 157,
      source: 'itunes'
    },
    {
      id: 'itunes_thriller',
      title: 'Thriller',
      artist: 'Michael Jackson',
      thumbnail: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/4a/60/79/4a6079c6-1d12-bf9e-8736-2856f671158a/886443672528.jpg/600x600bb.jpg',
      durationSeconds: 357,
      source: 'itunes'
    },
    {
      id: 'itunes_festigal_2005',
      title: 'פסטיבל 2005 - גיבורי הממלכה',
      artist: 'פסטיגל',
      thumbnail: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/91/bb/12/91bb1226-0e96-6d65-3efd-c24e6a0339d2/cover.jpg/600x600bb.jpg',
      durationSeconds: 210,
      source: 'itunes'
    },
    {
      id: 'itunes_festigal_2008',
      title: 'פסטיבל 2008 - תפוס אותי',
      artist: 'פסטיגל',
      thumbnail: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/80/7e/11/807e112d-94bb-1c4b-3543-ee835b801a22/cover.jpg/600x600bb.jpg',
      durationSeconds: 195,
      source: 'itunes'
    },
    {
      id: 'sc_432578775',
      title: 'עומר אדם בוקר טוב עם גידי גוב',
      artist: 'אהרון כהן',
      thumbnail: 'https://i1.sndcdn.com/artworks-000337714776-o15als-t500x500.jpg',
      durationSeconds: 129,
      source: 'soundcloud'
    }
  ]
};

export function getLikedSongs() {
  try {
    const raw = localStorage.getItem(LIKED_SONGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLikedSongs(tracks) {
  try {
    localStorage.setItem(LIKED_SONGS_KEY, JSON.stringify(tracks));
  } catch (e) {
    console.error('Failed to save liked songs:', e);
  }
}

export function toggleLikeSong(track) {
  const current = getLikedSongs();
  const exists = current.some(t => t.id === track.id || (t.title === track.title && t.artist === track.artist));
  let updated;
  if (exists) {
    updated = current.filter(t => t.id !== track.id && !(t.title === track.title && t.artist === track.artist));
  } else {
    updated = [track, ...current];
  }
  saveLikedSongs(updated);
  return { updated, isLiked: !exists };
}

export function isSongLiked(track, likedSongs) {
  if (!track) return false;
  return likedSongs.some(t => t.id === track.id || (t.title === track.title && t.artist === track.artist));
}

export function getPlaylists() {
  try {
    const raw = localStorage.getItem(PLAYLISTS_KEY);
    let list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];

    // Ensure the default built-in playlist 'שירים שאני אוהב' exists in the list
    const hasBuiltIn = list.some(p => p.id === BUILTIN_PLAYLIST_SONGS_I_LOVE.id || p.title === 'שירים שאני אוהב');
    if (!hasBuiltIn) {
      list = [BUILTIN_PLAYLIST_SONGS_I_LOVE, ...list];
      localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(list));
    }
    return list;
  } catch {
    return [BUILTIN_PLAYLIST_SONGS_I_LOVE];
  }
}

export function savePlaylist(playlist) {
  const playlists = getPlaylists();
  const index = playlists.findIndex(p => p.id === playlist.id);
  let updated;
  if (index >= 0) {
    updated = [...playlists];
    updated[index] = playlist;
  } else {
    updated = [playlist, ...playlists];
  }
  localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
  return updated;
}

export function deletePlaylist(playlistId) {
  const playlists = getPlaylists();
  const updated = playlists.filter(p => p.id !== playlistId);
  localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
  return updated;
}

export function getRecentTracks() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addRecentTrack(track) {
  try {
    const current = getRecentTracks().filter(t => t.id !== track.id);
    const updated = [track, ...current].slice(0, 30);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function isTrackInPlaylist(playlist, track) {
  if (!playlist || !playlist.tracks || !track) return false;
  return playlist.tracks.some(
    t => t.id === track.id ||
         (t.streamableId && t.streamableId === track.streamableId) ||
         (t.title === track.title && t.artist === track.artist)
  );
}

export function addTrackToPlaylist(playlistId, track) {
  try {
    const playlists = getPlaylists();
    const index = playlists.findIndex(p => p.id === playlistId);
    if (index === -1) return { updated: playlists, success: false, reason: 'Playlist not found' };

    const playlist = { ...playlists[index] };
    const existingTracks = playlist.tracks || [];

    if (isTrackInPlaylist(playlist, track)) {
      return { updated: playlists, success: false, alreadyExists: true };
    }

    const newTracks = [...existingTracks, track];
    playlist.tracks = newTracks;
    playlist.trackCount = newTracks.length;
    if (!playlist.cover && track.thumbnail) {
      playlist.cover = track.thumbnail;
    }

    const updated = [...playlists];
    updated[index] = playlist;
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
    return { updated, success: true, playlist };
  } catch (e) {
    console.error('Failed to add track to playlist:', e);
    return { updated: getPlaylists(), success: false };
  }
}

export function removeTrackFromPlaylist(playlistId, trackId) {
  try {
    const playlists = getPlaylists();
    const index = playlists.findIndex(p => p.id === playlistId);
    if (index === -1) return playlists;

    const playlist = { ...playlists[index] };
    const filteredTracks = (playlist.tracks || []).filter(
      t => t.id !== trackId && t.streamableId !== trackId
    );

    playlist.tracks = filteredTracks;
    playlist.trackCount = filteredTracks.length;

    const updated = [...playlists];
    updated[index] = playlist;
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error('Failed to remove track from playlist:', e);
    return getPlaylists();
  }
}

export function createCustomPlaylist(title, description = '') {
  try {
    const playlists = getPlaylists();
    const newPlaylist = {
      id: 'custom_' + Date.now(),
      title: title.trim(),
      description: description.trim(),
      type: 'playlist',
      cover: '',
      tracks: [],
      trackCount: 0,
      createdAt: new Date().toISOString()
    };

    const updated = [newPlaylist, ...playlists];
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
    return { updated, playlist: newPlaylist };
  } catch (e) {
    console.error('Failed to create playlist:', e);
    return { updated: getPlaylists(), playlist: null };
  }
}

export function reorderPlaylistTracks(playlistId, newTracks) {
  try {
    const playlists = getPlaylists();
    const index = playlists.findIndex(p => p.id === playlistId);
    if (index === -1) return playlists;

    const playlist = { ...playlists[index], tracks: newTracks, trackCount: newTracks.length };
    const updated = [...playlists];
    updated[index] = playlist;
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error('Failed to reorder playlist tracks:', e);
    return getPlaylists();
  }
}

export function reorderLikedSongs(newTracks) {
  try {
    saveLikedSongs(newTracks);
    return newTracks;
  } catch (e) {
    console.error('Failed to reorder liked songs:', e);
    return getLikedSongs();
  }
}

export function renamePlaylist(playlistId, newTitle) {
  try {
    const playlists = getPlaylists();
    const index = playlists.findIndex(p => p.id === playlistId);
    if (index === -1) return playlists;

    const playlist = { ...playlists[index], title: newTitle.trim() };
    const updated = [...playlists];
    updated[index] = playlist;
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error('Failed to rename playlist:', e);
    return getPlaylists();
  }
}
