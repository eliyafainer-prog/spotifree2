import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';
import { getPlayableAudioUrl } from '../services/directAudio';
import { addRecentTrack } from '../services/storage';
import { getOfflineTrack } from '../services/offlineStorage';
import { recordTrackPlay, recordListeningSeconds } from '../services/analytics';

// Inline Base64 44-byte silent WAV audio to guarantee 100% offline & safe mobile audio lock without 404s
const SILENT_AUDIO_URI = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

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
  const abortControllerRef = useRef(null);

  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { shuffleModeRef.current = shuffleMode; }, [shuffleMode]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);

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

  // Initialize Permanent HTML5 Audio Element for Background Playback
  useEffect(() => {
    let errorCount = 0;
    let lastErrorTrackId = null;

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

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
      recordListeningSeconds(0.25);
    };

    const onDurationChange = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const onPlaying = () => {
      errorCount = 0;
      setIsPlaying(true);
      setIsLoading(false);
      requestWakeLock();
      if (currentTrackRef.current) {
        startNativeForeground(currentTrackRef.current);
      }
    };

    const onPause = () => {
      setIsPlaying(false);
      releaseWakeLock();
      stopNativeForeground();
    };

    const onWaiting = () => {
      setIsLoading(true);
    };

    const onEnded = () => {
      handleNextTrack();
    };

    const onError = (e) => {
      // Ignore errors on data: URI or if audio source is empty
      if (!audio.src || audio.src.startsWith('data:')) {
        return;
      }

      console.warn('Audio playback error:', e);
      setIsLoading(false);
      setIsPlaying(false);
      releaseWakeLock();
      stopNativeForeground();
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
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

  // Main playback handler
  const playTrack = useCallback(async (track, newQueue = null, indexInQueue = -1) => {
    if (!track) return;
    userPausedRef.current = false;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    if (newQueue) {
      setQueue(newQueue);
      queueRef.current = newQueue;
      const idx = indexInQueue >= 0 ? indexInQueue : newQueue.findIndex(t => t.id === track.id);
      setQueueIndex(idx);
      queueIndexRef.current = idx;

      // Reset shuffle deck when queue changes
      if (shuffleModeRef.current !== 'off') {
        shuffledIndicesRef.current = generateShuffledDeck(newQueue.length, idx);
        shufflePosRef.current = 0;
      }
    } else if (indexInQueue >= 0) {
      setQueueIndex(indexInQueue);
      queueIndexRef.current = indexInQueue;
    }

    setCurrentTrack(track);
    currentTrackRef.current = track;
    setIsLoading(true);
    setCurrentTime(0);
    setDuration(track.durationSeconds || 0);

    // Save to history & analytics
    addRecentTrack(track);
    recordTrackPlay(track);

    try {
      // Hold the media session / audio lock on mobile by playing silence while fetching
      if (audioRef.current) {
        audioRef.current.src = SILENT_AUDIO_URI;
        audioRef.current.loop = true;
        await audioRef.current.play().catch(() => {});
      }

      // 1. Check if downloaded offline
      const offline = await getOfflineTrack(track);
      let streamUrl = '';

      if (offline && offline.audioBlob) {
        streamUrl = URL.createObjectURL(offline.audioBlob);
      } else {
        // 2. Fetch direct ad-free audio stream
        streamUrl = await getPlayableAudioUrl(track, signal);
      }

      if (currentTrackRef.current?.id !== track.id) return;

      if (audioRef.current && streamUrl) {
        audioRef.current.loop = false;
        audioRef.current.src = streamUrl;
        audioRef.current.currentTime = 0;
        if (!userPausedRef.current) {
          await audioRef.current.play();
          setIsPlaying(true);
        }
        setIsLoading(false);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('Playback error:', err);
        setIsLoading(false);
      }
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !currentTrack) return;

    if (isPlaying) {
      userPausedRef.current = true;
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      userPausedRef.current = false;
      audioRef.current.play().catch(console.warn);
      setIsPlaying(true);
    }
  }, [isPlaying, currentTrack]);

  const seek = useCallback((time) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  // Advance to Next Track
  const handleNextTrack = useCallback(async () => {
    const q = queueRef.current;
    const currentIdx = queueIndexRef.current;
    const repMode = repeatModeRef.current;
    const shufMode = shuffleModeRef.current;

    if (repMode === 'one' && currentTrackRef.current) {
      seek(0);
      audioRef.current?.play().catch(() => {});
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
