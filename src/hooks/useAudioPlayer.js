import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';
import { getPlayableAudioUrl, resolveYouTubeVideo } from '../services/directAudio';
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
  const ytPlayerRef = useRef(null);
  const isYtReadyRef = useRef(false);
  const pendingPlayRef = useRef(null);
  const activeEngineRef = useRef('youtube'); // 'youtube' | 'audio'
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

  // Initialize YouTube IFrame Player & HTML5 Audio Element
  useEffect(() => {
    // 1. Setup HTML5 Audio element (for offline blobs and audio fallback)
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
      if (activeEngineRef.current !== 'audio') return;
      setCurrentTime(audio.currentTime);
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
      recordListeningSeconds(0.25);
    };

    const onAudioDurationChange = () => {
      if (activeEngineRef.current !== 'audio') return;
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const onAudioPlaying = () => {
      if (activeEngineRef.current !== 'audio') return;
      setIsPlaying(true);
      setIsLoading(false);
      requestWakeLock();
      if (currentTrackRef.current) {
        startNativeForeground(currentTrackRef.current);
      }
    };

    const onAudioPause = () => {
      if (activeEngineRef.current !== 'audio') return;
      setIsPlaying(false);
      releaseWakeLock();
      stopNativeForeground();
    };

    const onAudioWaiting = () => {
      if (activeEngineRef.current !== 'audio') return;
      setIsLoading(true);
    };

    const onAudioEnded = () => {
      if (activeEngineRef.current !== 'audio') return;
      handleNextTrack();
    };

    const onAudioError = (e) => {
      if (activeEngineRef.current !== 'audio') return;
      console.warn('Audio playback error:', e);
      setIsLoading(false);
      setTimeout(() => handleNextTrack(), 1000);
    };

    audio.addEventListener('timeupdate', onAudioTimeUpdate);
    audio.addEventListener('durationchange', onAudioDurationChange);
    audio.addEventListener('playing', onAudioPlaying);
    audio.addEventListener('pause', onAudioPause);
    audio.addEventListener('waiting', onAudioWaiting);
    audio.addEventListener('ended', onAudioEnded);
    audio.addEventListener('error', onAudioError);

    // 2. Setup YouTube IFrame Player Target Container
    let ytContainer = document.getElementById('spotifree-yt-container');
    if (!ytContainer) {
      ytContainer = document.createElement('div');
      ytContainer.id = 'spotifree-yt-container';
      ytContainer.style.cssText = 'position:fixed;bottom:-9999px;right:-9999px;width:200px;height:200px;opacity:0.001;pointer-events:none;z-index:-9999;';
      const playerDiv = document.createElement('div');
      playerDiv.id = 'spotifree-yt-player-target';
      ytContainer.appendChild(playerDiv);
      document.body.appendChild(ytContainer);
    }

    const initYouTubePlayer = () => {
      if (!window.YT || !window.YT.Player || ytPlayerRef.current) return;
      try {
        ytPlayerRef.current = new window.YT.Player('spotifree-yt-player-target', {
          height: '200',
          width: '200',
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            playsinline: 1,
            rel: 0,
            enablejsapi: 1,
            origin: window.location.origin
          },
          events: {
            onReady: (evt) => {
              isYtReadyRef.current = true;
              const currentVol = Math.round((isMutedRef.current ? 0 : volumeRef.current) * 100);
              evt.target.setVolume(currentVol);

              if (pendingPlayRef.current) {
                const vid = pendingPlayRef.current;
                pendingPlayRef.current = null;
                evt.target.loadVideoById(vid);
                evt.target.playVideo();
              }
            },
            onStateChange: (evt) => {
              // YT.PlayerState: 1 = PLAYING, 2 = PAUSED, 3 = BUFFERING, 0 = ENDED
              if (activeEngineRef.current !== 'youtube') return;

              if (evt.data === 1) { // PLAYING
                setIsPlaying(true);
                setIsLoading(false);
                requestWakeLock();
                if (currentTrackRef.current) {
                  startNativeForeground(currentTrackRef.current);
                }
                const dur = ytPlayerRef.current?.getDuration?.();
                if (dur && !isNaN(dur) && dur > 0) {
                  setDuration(dur);
                }
              } else if (evt.data === 2) { // PAUSED
                setIsPlaying(false);
                releaseWakeLock();
                stopNativeForeground();
              } else if (evt.data === 3) { // BUFFERING
                setIsLoading(true);
              } else if (evt.data === 0) { // ENDED
                handleNextTrack();
              }
            },
            onError: (err) => {
              console.warn('YouTube Player error code:', err.data);
              setIsLoading(false);
              setTimeout(() => handleNextTrack(), 1200);
            }
          }
        });
      } catch (err) {
        console.warn('Failed to init YouTube Player:', err);
      }
    };

    if (window.YT && window.YT.Player) {
      initYouTubePlayer();
    } else {
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prevCallback) prevCallback();
        initYouTubePlayer();
      };
    }

    return () => {
      audio.removeEventListener('timeupdate', onAudioTimeUpdate);
      audio.removeEventListener('durationchange', onAudioDurationChange);
      audio.removeEventListener('playing', onAudioPlaying);
      audio.removeEventListener('pause', onAudioPause);
      audio.removeEventListener('waiting', onAudioWaiting);
      audio.removeEventListener('ended', onAudioEnded);
      audio.removeEventListener('error', onAudioError);
    };
  }, []);

  // Time tracking interval for YouTube Player
  useEffect(() => {
    let timer = null;
    if (isPlaying && activeEngineRef.current === 'youtube') {
      timer = setInterval(() => {
        if (ytPlayerRef.current?.getCurrentTime) {
          const t = ytPlayerRef.current.getCurrentTime();
          if (typeof t === 'number' && !isNaN(t)) {
            setCurrentTime(t);
            recordListeningSeconds(0.25);
          }
        }
      }, 250);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying]);

  // Update volume
  const setVolume = useCallback((val) => {
    const clamped = Math.max(0, Math.min(1, val));
    setVolumeState(clamped);
    setIsMuted(false);
    localStorage.setItem('spotifree_volume', clamped);

    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
    if (ytPlayerRef.current?.setVolume) {
      ytPlayerRef.current.setVolume(Math.round(clamped * 100));
    }
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      if (audioRef.current) {
        audioRef.current.volume = next ? 0 : volume;
      }
      if (ytPlayerRef.current) {
        if (next) {
          ytPlayerRef.current.mute?.();
        } else {
          ytPlayerRef.current.unMute?.();
          ytPlayerRef.current.setVolume?.(Math.round(volume * 100));
        }
      }
      return next;
    });
  }, [volume]);

  // Main playback handler
  const playTrack = useCallback(async (track, newQueue = null, indexInQueue = -1) => {
    if (!track) return;
    userPausedRef.current = false;

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
      // 1. Check if saved offline locally
      const offline = await getOfflineTrack(track);
      if (offline && offline.audioBlob) {
        activeEngineRef.current = 'audio';
        try { ytPlayerRef.current?.pauseVideo?.(); } catch (e) {}

        const blobUrl = URL.createObjectURL(offline.audioBlob);
        if (audioRef.current && !userPausedRef.current) {
          audioRef.current.src = blobUrl;
          audioRef.current.currentTime = 0;
          await audioRef.current.play();
          setIsPlaying(true);
          setIsLoading(false);
        }
        return;
      }

      // 2. Online Full-Track Playback via YouTube Engine
      activeEngineRef.current = 'youtube';
      try { audioRef.current?.pause?.(); } catch (e) {}

      let videoId = track.videoId;
      if (!videoId && track.id?.startsWith('yt_')) {
        videoId = track.id.replace('yt_', '');
      }

      // If videoId is not attached yet (e.g. Spotify imported track or iTunes), resolve it
      if (!videoId) {
        const resolved = await resolveYouTubeVideo(track.title, track.artist);
        if (resolved && resolved.videoId) {
          videoId = resolved.videoId;
          if (resolved.durationSeconds) {
            track.durationSeconds = resolved.durationSeconds;
            setDuration(resolved.durationSeconds);
          }
        }
      }

      if (videoId) {
        if (isYtReadyRef.current && ytPlayerRef.current?.loadVideoById) {
          ytPlayerRef.current.loadVideoById(videoId);
          ytPlayerRef.current.playVideo();
        } else {
          pendingPlayRef.current = videoId;
        }
        return;
      }

      // 3. Fallback to direct stream URL
      activeEngineRef.current = 'audio';
      const streamUrl = await getPlayableAudioUrl(track);
      if (streamUrl && audioRef.current && !userPausedRef.current) {
        audioRef.current.src = streamUrl;
        audioRef.current.currentTime = 0;
        await audioRef.current.play();
        setIsPlaying(true);
        setIsLoading(false);
      }
    } catch (err) {
      console.warn('Playback error:', err);
      setIsLoading(false);
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (!currentTrack) return;

    if (isPlaying) {
      userPausedRef.current = true;
      if (activeEngineRef.current === 'youtube') {
        ytPlayerRef.current?.pauseVideo?.();
      } else {
        audioRef.current?.pause?.();
      }
      setIsPlaying(false);
    } else {
      userPausedRef.current = false;
      if (activeEngineRef.current === 'youtube') {
        ytPlayerRef.current?.playVideo?.();
      } else {
        audioRef.current?.play?.().catch(console.warn);
      }
      setIsPlaying(true);
    }
  }, [isPlaying, currentTrack]);

  const seek = useCallback((time) => {
    if (activeEngineRef.current === 'youtube') {
      ytPlayerRef.current?.seekTo?.(time, true);
    } else if (audioRef.current) {
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
      if (activeEngineRef.current === 'youtube') {
        ytPlayerRef.current?.playVideo?.();
      } else {
        audioRef.current?.play?.().catch(() => {});
      }
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
