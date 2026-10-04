import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';
import { resolveDirectAudioStream } from '../services/directAudio';
import { addRecentTrack } from '../services/storage';
import { getOfflineTrack } from '../services/offlineStorage';
import { recordTrackPlay, recordListeningSeconds } from '../services/analytics';

const startNativeForeground = async (track) => {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      await ForegroundService.startForegroundService({
        id: 1001,
        title: track?.title || 'SpotiFree',
        body: track?.artist ? `${track.artist} • מנגן ברקע` : 'מנגן ברקע',
        smallIcon: 'ic_launcher_round',
        silent: true
      });
    } catch (e) {
      console.warn('Foreground service error:', e);
    }
  }
};

const stopNativeForeground = async () => {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      await ForegroundService.stopForegroundService();
    } catch (e) {
      console.warn('Stop foreground service error:', e);
    }
  }
};

// Fisher-Yates non-repeating shuffle permutation
function generateShuffledDeck(length, startingIndex = -1) {
  if (length <= 1) return [0];
  const indices = [];
  for (let i = 0; i < length; i++) {
    if (i !== startingIndex) indices.push(i);
  }
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return startingIndex >= 0 ? [startingIndex, ...indices] : indices;
}

export function useAudioPlayer() {
  const audioRef = useRef(null);
  const wakeLockRef = useRef(null);

  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(() => {
    const saved = localStorage.getItem('spotifree_volume');
    return saved !== null ? parseFloat(saved) : 0.8;
  });
  const [isMuted, setIsMuted] = useState(false);

  // Shuffle & Repeat Modes
  const [shuffleMode, setShuffleMode] = useState('off'); // 'off' | 'standard' | 'smart'
  const isShuffle = shuffleMode !== 'off';
  const [repeatMode, setRepeatMode] = useState('off'); // 'off' | 'all' | 'one'

  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(-1);

  // References for event listener callbacks without stale closures
  const queueRef = useRef([]);
  const queueIndexRef = useRef(-1);
  const currentTrackRef = useRef(null);
  const shuffleModeRef = useRef('off');
  const repeatModeRef = useRef('off');
  const shuffledIndicesRef = useRef([]);
  const shufflePosRef = useRef(0);
  const userPausedRef = useRef(false);
  const isMutedRef = useRef(false);
  const volumeRef = useRef(0.8);
  const abortControllerRef = useRef(null);
  const retryCountRef = useRef(0);

  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { shuffleModeRef.current = shuffleMode; }, [shuffleMode]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  // Request screen wake lock during playback if supported
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator && !wakeLockRef.current) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      } catch (err) {}
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  };

  // Setup MediaSession for lockscreen / mobile background controls
  const updateMediaSession = useCallback((track) => {
    if ('mediaSession' in navigator && track) {
      try {
        let artwork = [];
        if (track.thumbnail) {
          artwork = [
            { src: track.thumbnail, sizes: '96x96', type: 'image/jpeg' },
            { src: track.thumbnail, sizes: '128x128', type: 'image/jpeg' },
            { src: track.thumbnail, sizes: '256x256', type: 'image/jpeg' },
            { src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' }
          ];
        }
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title || 'SpotiFree',
          artist: track.artist || 'ללא פרסומות',
          album: track.album || 'SpotiFree',
          artwork
        });

        navigator.mediaSession.setActionHandler('play', () => togglePlay());
        navigator.mediaSession.setActionHandler('pause', () => togglePlay());
        navigator.mediaSession.setActionHandler('nexttrack', () => handleNextTrack());
        navigator.mediaSession.setActionHandler('previoustrack', () => handlePrevTrack());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (typeof details.seekTime === 'number') seek(details.seekTime);
        });
      } catch (e) {}
    }
  }, []);

  // Initialize Native HTML5 Audio Element & Listeners
  useEffect(() => {
    let audio = document.getElementById('spotifree-audio-engine');
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'spotifree-audio-engine';
      audio.preload = 'auto';
      audio.playsInline = true;
      audio.setAttribute('playsinline', 'true');
      audio.setAttribute('webkit-playsinline', 'true');
      audio.style.display = 'none';
      document.body.appendChild(audio);
    }
    audio.volume = isMuted ? 0 : volume;
    audioRef.current = audio;

    const onAudioTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      recordListeningSeconds(0.25);
    };

    const onAudioDurationChange = () => {
      if (audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    const onAudioPlaying = () => {
      setIsPlaying(true);
      setIsLoading(false);
      requestWakeLock();
      if (currentTrackRef.current) startNativeForeground(currentTrackRef.current);
    };

    const onAudioPause = () => {
      setIsPlaying(false);
      releaseWakeLock();
      stopNativeForeground();
    };

    const onAudioWaiting = () => {
      setIsLoading(true);
    };

    const onAudioCanPlay = () => {
      setIsLoading(false);
    };

    const onAudioEnded = () => {
      // Guard against spurious early ended events (e.g. initial buffer hiccup)
      if (!audio.src || audio.currentTime < 2) return;
      handleNextTrack();
    };

    const onAudioError = async (e) => {
      console.warn('HTML5 Audio error:', e);
      const track = currentTrackRef.current;
      if (track && retryCountRef.current < 1 && !userPausedRef.current) {
        retryCountRef.current += 1;
        try {
          const fresh = await resolveDirectAudioStream(track, true);
          if (fresh?.streamUrl) {
            audio.src = fresh.streamUrl;
            await audio.play();
            return;
          }
        } catch (err) {}
      }
      setIsLoading(false);
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', onAudioTimeUpdate);
    audio.addEventListener('durationchange', onAudioDurationChange);
    audio.addEventListener('playing', onAudioPlaying);
    audio.addEventListener('pause', onAudioPause);
    audio.addEventListener('waiting', onAudioWaiting);
    audio.addEventListener('canplay', onAudioCanPlay);
    audio.addEventListener('ended', onAudioEnded);
    audio.addEventListener('error', onAudioError);

    return () => {
      audio.removeEventListener('timeupdate', onAudioTimeUpdate);
      audio.removeEventListener('durationchange', onAudioDurationChange);
      audio.removeEventListener('playing', onAudioPlaying);
      audio.removeEventListener('pause', onAudioPause);
      audio.removeEventListener('waiting', onAudioWaiting);
      audio.removeEventListener('canplay', onAudioCanPlay);
      audio.removeEventListener('ended', onAudioEnded);
      audio.removeEventListener('error', onAudioError);
    };
  }, []);

  // Update volume
  const setVolume = useCallback((val) => {
    const clamped = Math.max(0, Math.min(1, val));
    setVolumeState(clamped);
    setIsMuted(false);
    localStorage.setItem('spotifree_volume', clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      if (audioRef.current) {
        audioRef.current.volume = next ? 0 : volume;
      }
      return next;
    });
  }, [volume]);

  // Pre-fetch next track in background for 0ms gapless transition
  const prefetchNextTrack = useCallback((q, currentIdx, shufMode) => {
    if (!q || q.length <= 1) return;
    let nextIdx = -1;
    if (shufMode !== 'off') {
      const nextPos = shufflePosRef.current + 1;
      if (nextPos < shuffledIndicesRef.current.length) {
        nextIdx = shuffledIndicesRef.current[nextPos];
      }
    } else if (currentIdx + 1 < q.length) {
      nextIdx = currentIdx + 1;
    }

    if (nextIdx >= 0 && q[nextIdx]) {
      // Warm up cache in background
      resolveDirectAudioStream(q[nextIdx]).catch(() => {});
    }
  }, []);

  // Main Full-Song Playback Handler (100% Native HTML5 Audio, ZERO Ads, Full Duration, 100% Background Playback)
  const playTrack = useCallback(async (track, newQueue = null, indexInQueue = -1) => {
    if (!track) return;
    userPausedRef.current = false;
    retryCountRef.current = 0;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    let targetQueue = queueRef.current;
    let targetIndex = queueIndexRef.current;

    if (newQueue) {
      setQueue(newQueue);
      queueRef.current = newQueue;
      targetQueue = newQueue;
      const idx = indexInQueue >= 0 ? indexInQueue : newQueue.findIndex(t => t.id === track.id);
      setQueueIndex(idx);
      queueIndexRef.current = idx;
      targetIndex = idx;

      // Reset shuffle deck when queue changes
      if (shuffleModeRef.current !== 'off') {
        shuffledIndicesRef.current = generateShuffledDeck(newQueue.length, idx);
        shufflePosRef.current = 0;
      }
    } else if (indexInQueue >= 0) {
      setQueueIndex(indexInQueue);
      queueIndexRef.current = indexInQueue;
      targetIndex = indexInQueue;
    }

    setCurrentTrack(track);
    currentTrackRef.current = track;
    setIsLoading(true);
    setCurrentTime(0);
    setDuration(track.durationSeconds || 0);

    // Save to history & analytics
    addRecentTrack(track);
    recordTrackPlay(track);
    updateMediaSession(track);

    const audio = audioRef.current;
    if (!audio) return;

    try {
      // 1. Check if saved offline locally (Blob audio)
      const offline = await getOfflineTrack(track);
      if (offline && offline.audioBlob) {
        const blobUrl = URL.createObjectURL(offline.audioBlob);
        if (!userPausedRef.current) {
          audio.src = blobUrl;
          audio.currentTime = 0;
          await audio.play();
          setIsPlaying(true);
          setIsLoading(false);
          prefetchNextTrack(targetQueue, targetIndex, shuffleModeRef.current);
        }
        return;
      }

      // 2. Direct Ad-Free Full-Length Audio Stream into native HTML5 <audio>
      const resolved = await resolveDirectAudioStream(track);
      if (!resolved || !resolved.streamUrl) {
        throw new Error('No playable stream found');
      }

      // Update track duration and metadata if enriched
      if (resolved.durationSeconds && resolved.durationSeconds > 0) {
        track.durationSeconds = resolved.durationSeconds;
        setDuration(resolved.durationSeconds);
      }
      if (resolved.videoId) {
        track.videoId = resolved.videoId;
      }
      if (resolved.thumbnail && (!track.thumbnail || track.thumbnail.includes('placeholder'))) {
        track.thumbnail = resolved.thumbnail;
      }
      setCurrentTrack({ ...track });
      updateMediaSession(track);

      if (!userPausedRef.current) {
        audio.src = resolved.streamUrl;
        audio.currentTime = 0;
        await audio.play();
        setIsPlaying(true);
        setIsLoading(false);
        prefetchNextTrack(targetQueue, targetIndex, shuffleModeRef.current);
      }
    } catch (err) {
      console.warn('Playback error:', err);
      setIsLoading(false);
    }
  }, [updateMediaSession, prefetchNextTrack]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrackRef.current) return;

    if (isPlaying) {
      userPausedRef.current = true;
      audio.pause();
      setIsPlaying(false);
    } else {
      userPausedRef.current = false;
      audio.play().catch(console.warn);
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const seek = useCallback((time) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    setCurrentTime(time);
  }, []);

  // Advance to Next Track
  const handleNextTrack = useCallback(async () => {
    const q = queueRef.current;
    const currentIdx = queueIndexRef.current;
    const repMode = repeatModeRef.current;
    const shufMode = shuffleModeRef.current;

    if (repMode === 'one' && currentTrackRef.current) {
      seek(0);
      audioRef.current?.play?.().catch(() => {});
      return;
    }

    if (!q || q.length === 0) return;

    let nextIdx = -1;

    if (shufMode !== 'off') {
      if (!shuffledIndicesRef.current || shuffledIndicesRef.current.length !== q.length) {
        shuffledIndicesRef.current = generateShuffledDeck(q.length, currentIdx);
        shufflePosRef.current = 0;
      }
      shufflePosRef.current += 1;
      if (shufflePosRef.current >= shuffledIndicesRef.current.length) {
        if (repMode === 'all') {
          shuffledIndicesRef.current = generateShuffledDeck(q.length);
          shufflePosRef.current = 0;
          nextIdx = shuffledIndicesRef.current[0];
        } else {
          return; // End of queue
        }
      } else {
        nextIdx = shuffledIndicesRef.current[shufflePosRef.current];
      }
    } else {
      if (currentIdx + 1 < q.length) {
        nextIdx = currentIdx + 1;
      } else if (repMode === 'all') {
        nextIdx = 0;
      }
    }

    if (nextIdx >= 0 && nextIdx < q.length) {
      playTrack(q[nextIdx], null, nextIdx);
    }
  }, [playTrack, seek]);

  // Previous Track
  const handlePrevTrack = useCallback(() => {
    if (currentTime > 3) {
      seek(0);
      return;
    }

    const q = queueRef.current;
    const currentIdx = queueIndexRef.current;

    if (!q || q.length === 0) return;

    if (shuffleModeRef.current !== 'off') {
      if (shufflePosRef.current > 0) {
        shufflePosRef.current -= 1;
      }
      const prevIdx = shuffledIndicesRef.current[shufflePosRef.current];
      if (prevIdx !== undefined && prevIdx >= 0 && prevIdx < q.length) {
        playTrack(q[prevIdx], null, prevIdx);
      }
      return;
    }

    let prevIdx = currentIdx - 1;
    if (prevIdx < 0) {
      prevIdx = q.length - 1;
    }

    if (prevIdx >= 0 && prevIdx < q.length) {
      playTrack(q[prevIdx], null, prevIdx);
    }
  }, [currentTime, playTrack, seek]);

  // Toggle Shuffle Mode ('off' -> 'standard' -> 'smart' -> 'off')
  const toggleShuffle = useCallback(() => {
    setShuffleMode(prev => {
      const next = prev === 'off' ? 'standard' : prev === 'standard' ? 'smart' : 'off';
      shuffleModeRef.current = next;
      if (next !== 'off' && queueRef.current.length > 0) {
        shuffledIndicesRef.current = generateShuffledDeck(queueRef.current.length, queueIndexRef.current);
        shufflePosRef.current = 0;
      }
      return next;
    });
  }, []);

  // Play Shuffled
  const playShuffled = useCallback((tracks) => {
    if (!tracks || tracks.length === 0) return;
    const deck = generateShuffledDeck(tracks.length);
    shuffledIndicesRef.current = deck;
    shufflePosRef.current = 0;
    setShuffleMode('standard');
    shuffleModeRef.current = 'standard';
    const firstIdx = deck[0];
    playTrack(tracks[firstIdx], tracks, firstIdx);
  }, [playTrack]);

  // Toggle Repeat Mode ('off' -> 'all' -> 'one' -> 'off')
  const toggleRepeat = useCallback(() => {
    setRepeatMode(prev => {
      const next = prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off';
      repeatModeRef.current = next;
      return next;
    });
  }, []);

  return {
    currentTrack,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    volume,
    isMuted,
    isShuffle,
    shuffleMode,
    repeatMode,
    queue,
    queueIndex,
    playTrack,
    togglePlay,
    nextTrack: handleNextTrack,
    prevTrack: handlePrevTrack,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    playShuffled,
    toggleRepeat
  };
}
