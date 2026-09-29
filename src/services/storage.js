const LIKED_SONGS_KEY = 'spotifree_liked_songs';
const PLAYLISTS_KEY = 'spotifree_playlists';
const RECENT_KEY = 'spotifree_recent_tracks';

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
    // Filter out any previously injected mock playlist
    const filtered = list.filter(p => p.id !== 'pl_songs_i_love_default');
    if (filtered.length !== list.length) {
      localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(filtered));
    }
    return filtered;
  } catch {
    return [];
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
