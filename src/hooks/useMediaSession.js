import { useEffect } from 'react';

export function useMediaSession({
  currentTrack,
  isPlaying,
  duration,
  currentTime,
  onPlay,
  onPause,
  onNext,
  onPrev,
  onSeek
}) {
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    try {
      let resolvedThumb = currentTrack.thumbnail || '';
      if (resolvedThumb && resolvedThumb.startsWith('/')) {
        resolvedThumb = window.location.origin + resolvedThumb;
      }

      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title || 'SpotiFree',
        artist: currentTrack.artist || 'ללא פרסומות',
        album: currentTrack.album || 'SpotiFree',
        artwork: resolvedThumb
          ? [
              { src: resolvedThumb, sizes: '96x96', type: 'image/jpeg' },
              { src: resolvedThumb, sizes: '128x128', type: 'image/jpeg' },
              { src: resolvedThumb, sizes: '256x256', type: 'image/jpeg' },
              { src: resolvedThumb, sizes: '512x512', type: 'image/jpeg' }
            ]
          : []
      });
    } catch (e) {
      console.warn('Failed to set mediaSession metadata:', e);
    }
  }, [currentTrack]);

  // Synchronize playback state (playing vs paused)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch (e) {}
  }, [isPlaying]);

  // Update lock screen scrubber position state
  useEffect(() => {
    if (!('mediaSession' in navigator) || !duration || isNaN(duration) || duration <= 0) return;
    try {
      if ('setPositionState' in navigator.mediaSession) {
        navigator.mediaSession.setPositionState({
          duration: Math.max(duration, 1),
          playbackRate: 1,
          position: Math.min(Math.max(currentTime || 0, 0), duration)
        });
      }
    } catch (e) {}
  }, [currentTime, duration]);

  // Register lock screen and headphone action handlers
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const actionHandlers = [
      ['play', onPlay],
      ['pause', onPause],
      ['previoustrack', onPrev],
      ['nexttrack', onNext],
      ['seekto', (details) => {
        if (details.seekTime !== undefined && onSeek) {
          onSeek(details.seekTime);
        }
      }],
      ['seekbackward', (details) => {
        const offset = details.seekOffset || 10;
        if (onSeek) onSeek(Math.max((currentTime || 0) - offset, 0));
      }],
      ['seekforward', (details) => {
        const offset = details.seekOffset || 10;
        if (onSeek) onSeek(Math.min((currentTime || 0) + offset, duration || 0));
      }]
    ];

    for (const [action, handler] of actionHandlers) {
      try {
        if (handler) {
          navigator.mediaSession.setActionHandler(action, handler);
        } else {
          navigator.mediaSession.setActionHandler(action, null);
        }
      } catch (e) {}
    }

    return () => {
      for (const [action] of actionHandlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch (e) {}
      }
    };
  }, [onPlay, onPause, onPrev, onNext, onSeek, currentTime, duration]);
}
