import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  PlusCircle,
  Heart,
  Music2,
  Sparkles,
  Flame,
  Clock,
  Play,
  Pause,
  Loader2,
  ArrowDownCircle,
  BarChart3,
  Library,
  Trash2
} from 'lucide-react';

import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useMediaSession } from './hooks/useMediaSession';
import { searchTracks, getTrendingTracks, getPlayableAudioUrl } from './services/directAudio';
import { getLyrics } from './services/lyrics';
import {
  getLikedSongs,
  toggleLikeSong,
  getPlaylists,
  savePlaylist,
  deletePlaylist,
  getRecentTracks,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  createCustomPlaylist,
  reorderPlaylistTracks,
  reorderLikedSongs,
  renamePlaylist
} from './services/storage';
import { saveTrackOffline, getAllOfflineTracks, deleteOfflineTrack } from './services/offlineStorage';

import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { PlayerBar } from './components/PlayerBar';
import { FullscreenPlayer } from './components/FullscreenPlayer';
import { SyncedLyrics } from './components/SyncedLyrics';
import { ImportModal } from './components/ImportModal';
import { AddToPlaylistModal } from './components/AddToPlaylistModal';
import { TrackRow } from './components/TrackRow';
import { PlaylistView } from './components/PlaylistView';
import { AnalyticsView } from './components/AnalyticsView';
import { OfflineView } from './components/OfflineView';


export default function App() {
  const player = useAudioPlayer();

  // Navigation & Views
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'search' | 'library' | 'liked' | 'playlist' | 'offline' | 'analytics'
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);

  // Storage State
  const [likedSongs, setLikedSongs] = useState(() => getLikedSongs());
  const [playlists, setPlaylists] = useState(() => getPlaylists());
  const [recentTracks, setRecentTracks] = useState(() => getRecentTracks());

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Trending tracks for Home view
  const [trendingTracks, setTrendingTracks] = useState([]);
  const [isTrendingLoading, setIsTrendingLoading] = useState(false);

  // Modals & Panels
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isFullscreenPlayerOpen, setIsFullscreenPlayerOpen] = useState(false);
  const [isLyricsOpen, setIsLyricsOpen] = useState(false);
  const [lyricsData, setLyricsData] = useState({ synced: [], plain: [], hasSynced: false });
  const [trackForAddToPlaylist, setTrackForAddToPlaylist] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const toastTimeoutRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 2800);
  }, []);

  // Offline Downloads state
  const [downloadedIds, setDownloadedIds] = useState(new Set());
  const [downloadingIds, setDownloadingIds] = useState(new Set());

  const refreshDownloads = useCallback(async () => {
    try {
      const tracks = await getAllOfflineTracks();
      setDownloadedIds(new Set(tracks.map(t => t.id)));
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    refreshDownloads();
  }, [refreshDownloads]);

  // Handle Download Track
  const handleDownloadTrack = async (track) => {
    if (!track || downloadedIds.has(track.id) || downloadingIds.has(track.id)) return;

    setDownloadingIds(prev => new Set([...prev, track.id]));
    showToast(`מוריד: ${track.title}...`);

    try {
      const streamUrl = await getPlayableAudioUrl(track);
      const res = await fetch(streamUrl);
      if (!res.ok) throw new Error('Download request failed');
      const blob = await res.blob();
      await saveTrackOffline(track, blob);
      setDownloadedIds(prev => new Set([...prev, track.id]));
      showToast(`הורדה הושלמה: ${track.title} נשמר במכשיר! 📥`);
    } catch (err) {
      console.error('Download failed:', err);
      showToast('נכשלה ההורדה למכשיר');
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }
  };

  // Lock Screen & Headphone Controls Integration
  useMediaSession({
    currentTrack: player.currentTrack,
    isPlaying: player.isPlaying,
    duration: player.duration,
    currentTime: player.currentTime,
    onPlay: player.togglePlay,
    onPause: player.togglePlay,
    onNext: player.nextTrack,
    onPrev: player.prevTrack,
    onSeek: player.seek
  });

  // Load trending tracks on mount
  useEffect(() => {
    let isMounted = true;
    setIsTrendingLoading(true);
    getTrendingTracks(18)
      .then(tracks => {
        if (isMounted) setTrendingTracks(tracks);
      })
      .catch(err => console.warn('Failed to load trending:', err))
      .finally(() => {
        if (isMounted) setIsTrendingLoading(false);
      });

    return () => { isMounted = false; };
  }, []);

  // Fetch lyrics whenever currentTrack changes
  useEffect(() => {
    if (!player.currentTrack) return;

    let isMounted = true;
    getLyrics(player.currentTrack.title, player.currentTrack.artist, player.currentTrack.durationSeconds)
      .then(data => {
        if (isMounted) setLyricsData(data);
      })
      .catch(() => {
        if (isMounted) setLyricsData({ synced: [], plain: [], hasSynced: false });
      });

    return () => { isMounted = false; };
  }, [player.currentTrack]);

  // Live debounced search (300ms)
  useEffect(() => {
    if (currentView !== 'search') return;
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let ignore = false;
    const timer = setTimeout(() => {
      setIsSearching(true);
      searchTracks(trimmed, 24)
        .then(results => {
          if (!ignore) setSearchResults(results);
        })
        .catch(err => console.warn('Search error:', err))
        .finally(() => {
          if (!ignore) setIsSearching(false);
        });
    }, 300);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [searchQuery, currentView]);

  // Immediate Search submit on Enter
  const handleSearchSubmit = async (e) => {
    e?.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    setIsSearching(true);
    try {
      const results = await searchTracks(trimmed, 24);
      setSearchResults(results);
    } catch (err) {
      console.warn('Search submit error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Playback handlers
  const handlePlayTrack = useCallback((track, queue = null, index = -1) => {
    player.playTrack(track, queue, index);
  }, [player]);

  const handleToggleLike = useCallback((track) => {
    const { updated, isLiked } = toggleLikeSong(track);
    setLikedSongs(updated);
    showToast(isLiked ? 'נוסף לשירים שאהבתי 💚' : 'הוסר מהשירים שאהבתי');
  }, [showToast]);

  const handleToggleShuffle = useCallback(() => {
    const current = player.shuffleMode;
    const nextMode = current === 'off' ? 'standard' : current === 'standard' ? 'smart' : 'off';
    player.toggleShuffle();
    if (nextMode === 'standard') {
      showToast('🔀 השמעה אקראית: מופעלת (שירים מעורבבים ללא חזרות)');
    } else if (nextMode === 'smart') {
      showToast('✨ ערבוב חכם: מופעל (Smart Shuffle)');
    } else {
      showToast('➡️ השמעה אקראית: כבויה (ניגון לפי הסדר)');
    }
  }, [player, showToast]);

  const handlePlayShuffled = useCallback((trackList) => {
    if (!trackList || trackList.length === 0) return;
    player.playShuffled(trackList);
    showToast('🔀 השמעה אקראית: מופעלת');
  }, [player, showToast]);

  // Playlist Management
  const handlePlaylistImported = (newPlaylist) => {
    const updated = savePlaylist(newPlaylist);
    setPlaylists(updated);
    setSelectedPlaylistId(newPlaylist.id);
    setCurrentView('playlist');
    showToast(`הפלייליסט "${newPlaylist.title}" יובא בהצלחה! 🎉`);
  };

  const handleDeletePlaylist = (playlistId) => {
    const updated = deletePlaylist(playlistId);
    setPlaylists(updated);
    setSelectedPlaylistId(null);
    setCurrentView('library');
    showToast('הפלייליסט נמחק');
  };

  const handleCreatePlaylist = (title, initialTrack = null) => {
    const { updated, playlist } = createCustomPlaylist(title);
    if (initialTrack && playlist) {
      const { updated: withTrack } = addTrackToPlaylist(playlist.id, initialTrack);
      setPlaylists(withTrack);
    } else {
      setPlaylists(updated);
    }
    showToast(`הפלייליסט "${title}" נוצר בהצלחה!`);
  };

  const handleAddToPlaylist = (playlistId, track) => {
    const { updated, success, alreadyExists } = addTrackToPlaylist(playlistId, track);
    if (alreadyExists) {
      showToast('השיר כבר קיים בפלייליסט זה');
    } else if (success) {
      setPlaylists(updated);
      showToast('השיר נוסף לפלייליסט בהצלחה! 🎶');
    }
  };

  const handleRemoveTrackFromPlaylist = (playlistId, trackId) => {
    const updated = removeTrackFromPlaylist(playlistId, trackId);
    setPlaylists(updated);
    showToast('השיר הוסר מהפלייליסט');
  };

  const handleReorderPlaylist = (playlistId, newTracks) => {
    const updated = reorderPlaylistTracks(playlistId, newTracks);
    setPlaylists(updated);
  };

  const handleReorderLiked = (newTracks) => {
    const updated = reorderLikedSongs(newTracks);
    setLikedSongs(updated);
  };

  const handleRenamePlaylist = (playlistId, newTitle) => {
    const updated = renamePlaylist(playlistId, newTitle);
    setPlaylists(updated);
    showToast('שם הפלייליסט עודכן');
  };

  const handleOpenAddToPlaylist = (track) => {
    setTrackForAddToPlaylist(track);
  };

  const handleCloseAddToPlaylist = () => {
    setTrackForAddToPlaylist(null);
  };

  const activePlaylist = playlists.find(p => p.id === selectedPlaylistId);
  const isLikedPlaylist = currentView === 'liked';

  return (
    <div className="flex flex-col h-full w-full max-w-full bg-spotify-base text-white overflow-hidden select-none font-sans" dir="rtl">
      {/* Main Layout Area */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left Desktop Sidebar */}
        <Sidebar
          currentView={currentView}
          setCurrentView={setCurrentView}
          playlists={playlists}
          openImportModal={() => setIsImportModalOpen(true)}
          onCreatePlaylist={() => handleCreatePlaylist(`הפלייליסט שלי #${playlists.length + 1}`)}
          selectedPlaylistId={selectedPlaylistId}
          setSelectedPlaylistId={setSelectedPlaylistId}
        />

        {/* Center Main View Area */}
        <main className="flex-1 flex flex-col min-w-0 bg-gradient-to-b from-spotify-dark/80 via-spotify-base to-spotify-base overflow-hidden relative">
          {/* Top Sticky Header */}
          <div className="sticky top-0 z-30 flex items-center justify-between px-4 md:px-6 py-3.5 bg-spotify-base/90 backdrop-blur-md border-b border-white/5">
            <div className="flex items-center gap-3 flex-1 max-w-xl">
              {currentView === 'search' ? (
                <form onSubmit={handleSearchSubmit} className="relative w-full">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => setIsSearchFocused(true)}
                    onBlur={() => setIsSearchFocused(false)}
                    placeholder="איזה שיר, אמן או אלבום תרצה לשמוע?"
                    autoFocus
                    className="w-full bg-spotify-elevated hover:bg-spotify-highlight focus:bg-spotify-highlight text-white placeholder-spotify-subtext text-sm rounded-full py-2.5 pr-10 pl-4 border border-transparent focus:border-white/20 outline-none transition-all shadow-inner"
                  />
                  <Search className="w-4 h-4 text-spotify-subtext absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-spotify-green flex items-center justify-center text-black font-black md:hidden shadow-md">
                    <Music2 className="w-4 h-4 fill-black" />
                  </div>
                  <h1 className="font-bold text-lg md:text-xl text-white truncate">
                    {currentView === 'home' && 'בוקר טוב'}
                    {currentView === 'library' && 'הספרייה שלך'}
                    {currentView === 'liked' && 'שירים שאהבתי'}
                    {currentView === 'offline' && 'הורדות אופליין'}
                    {currentView === 'analytics' && 'סטטיסטיקות והרגלי האזנה'}
                    {currentView === 'playlist' && (activePlaylist?.title || 'פלייליסט')}
                  </h1>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsImportModalOpen(true)}
                title="ייבוא פלייליסט מספוטיפיי / יוטיוב"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-spotify-elevated hover:bg-spotify-highlight text-xs font-bold text-spotify-green border border-spotify-green/20 transition-all hover:scale-105"
              >
                <PlusCircle className="w-4 h-4" />
                <span className="hidden sm:inline">ייבוא פלייליסט</span>
              </button>
            </div>
          </div>

          {/* View Content Scrollable Area */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-6">
            {/* VIEW: HOME */}
            {currentView === 'home' && (
              <div className="flex flex-col gap-8 animate-fadeIn">
                {/* Hero Greeting Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div
                    onClick={() => setCurrentView('liked')}
                    className="flex items-center gap-3 bg-spotify-elevated hover:bg-spotify-highlight rounded-md overflow-hidden cursor-pointer transition-colors group p-2"
                  >
                    <div className="w-14 h-14 rounded bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center flex-shrink-0 shadow">
                      <Heart className="w-7 h-7 fill-white text-white" />
                    </div>
                    <span className="font-bold text-sm">שירים שאהבתי</span>
                  </div>

                  <div
                    onClick={() => setIsImportModalOpen(true)}
                    className="flex items-center gap-3 bg-spotify-elevated hover:bg-spotify-highlight rounded-md overflow-hidden cursor-pointer transition-colors group p-2"
                  >
                    <div className="w-14 h-14 rounded bg-spotify-highlight flex items-center justify-center flex-shrink-0 text-spotify-green border border-spotify-green/20">
                      <PlusCircle className="w-7 h-7" />
                    </div>
                    <span className="font-bold text-sm">ייבוא פלייליסט מספוטיפיי</span>
                  </div>

                  <div
                    onClick={() => setCurrentView('offline')}
                    className="flex items-center gap-3 bg-spotify-elevated hover:bg-spotify-highlight rounded-md overflow-hidden cursor-pointer transition-colors group p-2"
                  >
                    <div className="w-14 h-14 rounded bg-gradient-to-br from-teal-700 to-cyan-900 flex items-center justify-center flex-shrink-0 text-white shadow">
                      <ArrowDownCircle className="w-7 h-7" />
                    </div>
                    <span className="font-bold text-sm">הורדות אופליין</span>
                  </div>
                </div>

                {/* Recently Played */}
                {recentTracks.length > 0 && (
                  <section className="flex flex-col gap-4">
                    <div className="flex items-center gap-2 text-white font-bold text-lg md:text-xl">
                      <Clock className="w-5 h-5 text-spotify-green" />
                      <h2>הושמע לאחרונה</h2>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
                      {recentTracks.slice(0, 6).map((track, idx) => (
                        <div
                          key={track.id || idx}
                          onClick={() => handlePlayTrack(track, recentTracks, idx)}
                          className="bg-spotify-dark hover:bg-spotify-elevated p-3 rounded-lg flex flex-col gap-2.5 group cursor-pointer transition-all duration-200"
                        >
                          <div className="relative aspect-square w-full rounded-md overflow-hidden bg-spotify-highlight shadow-md">
                            {track.thumbnail ? (
                              <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Music2 className="w-10 h-10 m-auto text-spotify-subtext" />
                            )}
                            <button className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-spotify-green text-black flex items-center justify-center shadow-lg opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 hover:scale-105">
                              <Play className="w-5 h-5 fill-current translate-x-0.5" />
                            </button>
                          </div>
                          <span className="font-bold text-xs truncate text-white">{track.title}</span>
                          <span className="text-[11px] text-spotify-subtext truncate">{track.artist}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Trending & Hits */}
                <section className="flex flex-col gap-4">
                  <div className="flex items-center gap-2 text-white font-bold text-lg md:text-xl">
                    <Flame className="w-5 h-5 text-spotify-green" />
                    <h2>להיטים מומלצים</h2>
                  </div>

                  {isTrendingLoading ? (
                    <div className="flex items-center justify-center p-12 text-spotify-subtext gap-3">
                      <Loader2 className="w-6 h-6 animate-spin text-spotify-green" />
                      <span>טוען להיטים מומלצים...</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
                      {trendingTracks.map((track, idx) => (
                        <div
                          key={track.id || idx}
                          onClick={() => handlePlayTrack(track, trendingTracks, idx)}
                          className="bg-spotify-dark hover:bg-spotify-elevated p-3 rounded-lg flex flex-col gap-2.5 group cursor-pointer transition-all duration-200"
                        >
                          <div className="relative aspect-square w-full rounded-md overflow-hidden bg-spotify-highlight shadow-md">
                            {track.thumbnail ? (
                              <img src={track.thumbnail} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Music2 className="w-10 h-10 m-auto text-spotify-subtext" />
                            )}
                            <button className={`absolute bottom-2 right-2 w-10 h-10 rounded-full bg-spotify-green text-black flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-105 ${
                              player.currentTrack?.id === track.id
                                ? 'opacity-100 translate-y-0'
                                : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'
                            }`}>
                              {player.currentTrack?.id === track.id && player.isLoading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : player.currentTrack?.id === track.id && player.isPlaying ? (
                                <Pause className="w-5 h-5 fill-current" />
                              ) : (
                                <Play className="w-5 h-5 fill-current translate-x-0.5" />
                              )}
                            </button>
                          </div>
                          <span className="font-bold text-xs truncate text-white">{track.title}</span>
                          <span className="text-[11px] text-spotify-subtext truncate">{track.artist}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* VIEW: SEARCH */}
            {currentView === 'search' && (
              <div className="flex flex-col gap-4 animate-fadeIn">
                {isSearching ? (
                  <div className="flex items-center justify-center p-12 text-spotify-subtext gap-3">
                    <Loader2 className="w-6 h-6 animate-spin text-spotify-green" />
                    <span>מחפש שירים ללא פרסומות...</span>
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <h2 className="font-bold text-lg text-white mb-2">תוצאות חיפוש</h2>
                    {searchResults.map((track, idx) => (
                      <TrackRow
                        key={track.id || idx}
                        index={idx}
                        track={track}
                        isCurrentTrack={player.currentTrack?.id === track.id}
                        isPlaying={player.isPlaying}
                        isLoading={player.isLoading}
                        onPlay={(t) => handlePlayTrack(t, searchResults, idx)}
                        isLiked={likedSongs.some(s => s.id === track.id || (s.title === track.title && s.artist === track.artist))}
                        onToggleLike={handleToggleLike}
                        isDownloaded={downloadedIds?.has(track.id)}
                        isDownloading={downloadingIds?.has(track.id)}
                        onDownload={handleDownloadTrack}
                        onOpenAddToPlaylist={handleOpenAddToPlaylist}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-spotify-subtext gap-2">
                    <Search className="w-12 h-12 text-spotify-subtext/40 mb-2" />
                    <p className="font-medium text-base">חפש כל שיר, אמן או אלבום שתרצה</p>
                    <p className="text-xs text-spotify-subtext/60">המוזיקה תתנגן ישירות באיכות גבוהה, ללא פרסומות וברקע</p>
                  </div>
                )}
              </div>
            )}

            {/* VIEW: LIBRARY */}
            {currentView === 'library' && (
              <div className="flex flex-col gap-6 animate-fadeIn">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {/* Liked Songs Tile */}
                  <div
                    onClick={() => setCurrentView('liked')}
                    className="aspect-square rounded-lg bg-gradient-to-br from-indigo-700 via-purple-700 to-pink-600 p-4 flex flex-col justify-end shadow-xl cursor-pointer hover:scale-[1.02] transition-transform"
                  >
                    <Heart className="w-8 h-8 fill-white mb-2" />
                    <h3 className="font-black text-xl text-white">שירים שאהבתי</h3>
                    <p className="text-xs text-white/80">{likedSongs.length} שירים שמורים</p>
                  </div>

                  {/* Offline Downloads Tile */}
                  <div
                    onClick={() => setCurrentView('offline')}
                    className="aspect-square rounded-lg bg-gradient-to-br from-teal-700 via-emerald-800 to-cyan-900 p-4 flex flex-col justify-end shadow-xl cursor-pointer hover:scale-[1.02] transition-transform"
                  >
                    <ArrowDownCircle className="w-8 h-8 text-white mb-2" />
                    <h3 className="font-black text-xl text-white">הורדות אופליין</h3>
                    <p className="text-xs text-white/80">{downloadedIds.size} שירים שמורים במכשיר</p>
                  </div>

                  {/* Playlists Tiles */}
                  {playlists.map(pl => (
                    <div
                      key={pl.id}
                      onClick={() => {
                        setSelectedPlaylistId(pl.id);
                        setCurrentView('playlist');
                      }}
                      className="bg-spotify-dark hover:bg-spotify-elevated p-3 rounded-lg flex flex-col gap-2.5 cursor-pointer transition-colors group"
                    >
                      <div className="relative aspect-square rounded-md overflow-hidden bg-spotify-highlight">
                        {pl.cover ? (
                          <img src={pl.cover} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Music2 className="w-10 h-10 m-auto text-spotify-subtext" />
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePlaylist(pl.id);
                            showToast(`הפלייליסט "${pl.title}" נמחק`);
                          }}
                          title="מחק פלייליסט"
                          className="absolute top-2 left-2 p-1.5 rounded-full bg-black/60 hover:bg-red-600/90 text-white/80 hover:text-white transition-all opacity-80 md:opacity-0 md:group-hover:opacity-100 shadow"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className="font-bold text-sm text-white truncate">{pl.title}</span>
                      <span className="text-xs text-spotify-subtext">{pl.tracks?.length || 0} שירים</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* VIEW: LIKED SONGS */}
            {isLikedPlaylist && (
              <PlaylistView
                playlist={{
                  id: 'liked',
                  title: 'שירים שאהבתי (Liked Songs)',
                  cover: likedSongs[0]?.thumbnail || '',
                  type: 'Favorites',
                  tracks: likedSongs
                }}
                currentTrack={player.currentTrack}
                isPlaying={player.isPlaying}
                isLoading={player.isLoading}
                onPlayTrack={handlePlayTrack}
                likedSongs={likedSongs}
                onToggleLike={handleToggleLike}
                downloadedIds={downloadedIds}
                downloadingIds={downloadingIds}
                onDownloadTrack={handleDownloadTrack}
                onOpenAddToPlaylist={handleOpenAddToPlaylist}
                shuffleMode={player.shuffleMode}
                onToggleShuffle={handleToggleShuffle}
                onPlayShuffled={handlePlayShuffled}
                onReorderTracks={handleReorderLiked}
              />
            )}

            {/* VIEW: SPECIFIC PLAYLIST */}
            {currentView === 'playlist' && activePlaylist && (
              <PlaylistView
                playlist={activePlaylist}
                currentTrack={player.currentTrack}
                isPlaying={player.isPlaying}
                isLoading={player.isLoading}
                onPlayTrack={handlePlayTrack}
                likedSongs={likedSongs}
                onToggleLike={handleToggleLike}
                onDeletePlaylist={handleDeletePlaylist}
                downloadedIds={downloadedIds}
                downloadingIds={downloadingIds}
                onDownloadTrack={handleDownloadTrack}
                onOpenAddToPlaylist={handleOpenAddToPlaylist}
                onRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
                shuffleMode={player.shuffleMode}
                onToggleShuffle={handleToggleShuffle}
                onPlayShuffled={handlePlayShuffled}
                onReorderTracks={(newTracks) => handleReorderPlaylist(activePlaylist.id, newTracks)}
                onRenamePlaylist={(newTitle) => handleRenamePlaylist(activePlaylist.id, newTitle)}
              />
            )}

            {/* VIEW: OFFLINE DOWNLOADS */}
            {currentView === 'offline' && (
              <OfflineView
                currentTrack={player.currentTrack}
                isPlaying={player.isPlaying}
                onPlayTrack={handlePlayTrack}
                likedSongs={likedSongs}
                onToggleLike={handleToggleLike}
                onTrackDeleted={refreshDownloads}
                shuffleMode={player.shuffleMode}
                onToggleShuffle={handleToggleShuffle}
                onPlayShuffled={handlePlayShuffled}
              />
            )}

            {/* VIEW: DATA ANALYTICS & STATS */}
            {currentView === 'analytics' && (
              <AnalyticsView />
            )}
          </div>
        </main>
      </div>

      {/* Fixed Bottom Player Controls */}
      <PlayerBar
        currentTrack={player.currentTrack}
        isPlaying={player.isPlaying}
        isLoading={player.isLoading}
        currentTime={player.currentTime}
        duration={player.duration}
        volume={player.volume}
        isMuted={player.isMuted}
        isShuffle={player.isShuffle}
        shuffleMode={player.shuffleMode}
        repeatMode={player.repeatMode}
        onTogglePlay={player.togglePlay}
        onNext={player.nextTrack}
        onPrev={player.prevTrack}
        onSeek={player.seek}
        onSetVolume={player.setVolume}
        onToggleMute={player.toggleMute}
        onToggleShuffle={handleToggleShuffle}
        onToggleRepeat={player.toggleRepeat}
        isLiked={likedSongs.some(s => s.id === player.currentTrack?.id || (s.title === player.currentTrack?.title && s.artist === player.currentTrack?.artist))}
        onToggleLike={handleToggleLike}
        onOpenLyrics={() => setIsLyricsOpen(true)}
        onOpenFullscreen={() => setIsFullscreenPlayerOpen(true)}
      />

      {/* Mobile Bottom Tab Bar */}
      {!isSearchFocused && (
        <MobileNav
          currentView={currentView}
          setCurrentView={setCurrentView}
          openImportModal={() => setIsImportModalOpen(true)}
          setSelectedPlaylistId={setSelectedPlaylistId}
        />
      )}

      {/* Fullscreen Player (Mobile Swipe-up / Expanded View) */}
      <FullscreenPlayer
        isOpen={isFullscreenPlayerOpen}
        onClose={() => setIsFullscreenPlayerOpen(false)}
        currentTrack={player.currentTrack}
        isPlaying={player.isPlaying}
        currentTime={player.currentTime}
        duration={player.duration}
        onTogglePlay={player.togglePlay}
        onNext={player.nextTrack}
        onPrev={player.prevTrack}
        onSeek={player.seek}
        isShuffle={player.isShuffle}
        shuffleMode={player.shuffleMode}
        onToggleShuffle={handleToggleShuffle}
        repeatMode={player.repeatMode}
        onToggleRepeat={player.toggleRepeat}
        isLiked={likedSongs.some(s => s.id === player.currentTrack?.id || (s.title === player.currentTrack?.title && s.artist === player.currentTrack?.artist))}
        onToggleLike={handleToggleLike}
        onOpenLyrics={() => {
          setIsFullscreenPlayerOpen(false);
          setIsLyricsOpen(true);
        }}
      />

      {/* Synced Karaoke Lyrics Modal */}
      {isLyricsOpen && (
        <SyncedLyrics
          lyricsData={lyricsData}
          currentTime={player.currentTime}
          duration={player.duration}
          isPlaying={player.isPlaying}
          isLoading={player.isLoading}
          onSeek={player.seek}
          onTogglePlay={player.togglePlay}
          onNext={player.nextTrack}
          onPrev={player.prevTrack}
          isShuffle={player.isShuffle}
          shuffleMode={player.shuffleMode}
          onToggleShuffle={handleToggleShuffle}
          isLiked={likedSongs.some(s => s.id === player.currentTrack?.id || (s.title === player.currentTrack?.title && s.artist === player.currentTrack?.artist))}
          onToggleLike={handleToggleLike}
          onClose={() => setIsLyricsOpen(false)}
          currentTrack={player.currentTrack}
        />
      )}

      {/* Playlist Importer Modal */}
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onPlaylistImported={handlePlaylistImported}
      />

      {/* Add Track To Playlist Modal */}
      <AddToPlaylistModal
        isOpen={!!trackForAddToPlaylist}
        track={trackForAddToPlaylist}
        onClose={handleCloseAddToPlaylist}
        playlists={playlists}
        onAddToPlaylist={handleAddToPlaylist}
        onCreatePlaylist={handleCreatePlaylist}
      />

      {/* Floating Status Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-full bg-spotify-elevated/95 text-white font-bold text-sm shadow-2xl border border-white/10 backdrop-blur-xl flex items-center gap-2.5 animate-fadeIn pointer-events-none">
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
