import React, { useState } from 'react';
import { X, DownloadCloud, Loader2, Music, Check, Sparkles, Link2, AlertCircle, Play } from 'lucide-react';
import { importPlaylistFromUrl } from '../services/spotifyImport';

export function ImportModal({ isOpen, onClose, onPlaylistImported }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  if (!isOpen) return null;

  const handleFetchLink = async (e) => {
    e?.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError('');
    setProgressMsg('מפענח קישור באמצעות AI Reader...');
    setPreview(null);

    try {
      const result = await importPlaylistFromUrl(url.trim(), (current, total, trackName) => {
        if (total > 0) {
          setProgressMsg(`מתאים עטיפות HD וקובצי שמע (${current}/${total}): "${trackName.substring(0, 24)}..."`);
        } else {
          setProgressMsg(trackName || 'מחלץ שירים מהפלייליסט...');
        }
      });
      setPreview(result);
    } catch (err) {
      setError(err.message || 'נכשל פיענוח הקישור. ודא שהפלייליסט בספוטיפיי מוגדר כציבורי (Public).');
    } finally {
      setLoading(false);
      setProgressMsg('');
    }
  };

  const handleSave = () => {
    if (!preview) return;

    const newPlaylist = {
      id: `pl_${Date.now()}`,
      title: preview.title || 'פלייליסט חדש',
      cover: preview.cover || '',
      type: preview.type || 'Custom Playlist',
      tracks: preview.tracks || [],
      createdAt: Date.now()
    };

    onPlaylistImported(newPlaylist);
    onClose();
    setUrl('');
    setPreview(null);
  };

  const sampleSpotifyUrl = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
  const sampleYouTubeUrl = 'https://www.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-spotify-dark border border-spotify-border rounded-xl max-w-lg w-full p-6 flex flex-col gap-4 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-spotify-green/20 text-spotify-green flex items-center justify-center shadow-lg">
              <DownloadCloud className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-lg text-white">ייבוא פלייליסט חכם</h2>
                <span className="text-[10px] bg-spotify-green/20 text-spotify-green font-bold px-2 py-0.5 rounded-full flex items-center gap-1 border border-spotify-green/30">
                  <Sparkles className="w-3 h-3" />
                  AI Powered
                </span>
              </div>
              <p className="text-xs text-spotify-subtext">ייבוא אוטומטי מלא עם עטיפות HD 600x600 וקובצי שמע רשמיים</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-spotify-subtext hover:text-white p-1 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* URL Form */}
        <form onSubmit={handleFetchLink} className="flex flex-col gap-3">
          <label className="text-xs font-semibold text-spotify-subtext">
            הדבק קישור לפלייליסט, אלבום או שיר מספוטיפיי או מיוטיוב:
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Link2 className="w-4 h-4 text-spotify-subtext absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="https://open.spotify.com/playlist/... או קישור יוטיוב"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoFocus
                className="w-full bg-spotify-elevated text-white text-sm pr-10 pl-3.5 py-2.5 rounded-lg border border-spotify-border focus:border-spotify-green focus:outline-none transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="bg-spotify-green hover:bg-spotify-green-hover disabled:opacity-50 text-black font-bold px-5 py-2.5 rounded-lg text-sm transition-all flex items-center gap-2 shadow-lg shadow-spotify-green/20"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>מייבא...</span>
                </>
              ) : (
                'ייבא ב-AI'
              )}
            </button>
          </div>

          {loading && (
            <div className="p-3 bg-spotify-elevated/70 border border-spotify-green/30 rounded-lg flex items-center gap-2.5 animate-fadeIn">
              <Loader2 className="w-4 h-4 animate-spin text-spotify-green flex-shrink-0" />
              <span className="text-xs text-spotify-green font-medium truncate">{progressMsg}</span>
            </div>
          )}

          <div className="text-[11px] text-spotify-subtext flex flex-wrap items-center gap-2 mt-0.5">
            <Sparkles className="w-3.5 h-3.5 text-spotify-green" />
            <span>דוגמאות לבדיקה מהירה:</span>
            <button
              type="button"
              onClick={() => setUrl(sampleSpotifyUrl)}
              className="text-spotify-green underline hover:text-spotify-green-hover transition-colors"
            >
              Today's Top Hits (Spotify)
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={() => setUrl(sampleYouTubeUrl)}
              className="text-spotify-green underline hover:text-spotify-green-hover transition-colors"
            >
              Top Pop Playlist (YouTube)
            </button>
          </div>
        </form>

        {/* Error message */}
        {error && (
          <div className="p-3 bg-red-900/30 border border-red-500/40 rounded-lg text-xs text-red-300 flex items-center gap-2 animate-fadeIn">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Preview of loaded playlist with track list */}
        {preview && (
          <div className="p-4 bg-spotify-elevated rounded-xl border border-spotify-border flex flex-col gap-3.5 animate-fadeIn">
            <div className="flex items-center gap-3.5">
              {preview.cover ? (
                <img src={preview.cover} alt="" className="w-16 h-16 rounded-lg object-cover shadow-lg flex-shrink-0 border border-white/10" />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-spotify-highlight flex items-center justify-center text-spotify-subtext flex-shrink-0">
                  <Music className="w-7 h-7" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <span className="text-[11px] uppercase tracking-wider text-spotify-subtext font-bold">{preview.type || 'Playlist'}</span>
                <h3 className="font-black text-white text-base truncate">{preview.title}</h3>
                <p className="text-xs text-spotify-green font-medium flex items-center gap-1 mt-0.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>{preview.tracks?.length || 0} שירים יובאו עם עטיפות HD ושמע זמין!</span>
                </p>
              </div>
            </div>

            {/* Scrollable list of imported tracks */}
            <div className="max-h-52 overflow-y-auto flex flex-col gap-1.5 p-1 bg-black/30 rounded-lg border border-white/5">
              {preview.tracks?.slice(0, 20).map((t, idx) => (
                <div key={t.id || idx} className="flex items-center gap-2.5 p-1.5 rounded hover:bg-white/5 transition-colors">
                  <span className="text-[11px] text-spotify-subtext w-4 text-center font-mono">{idx + 1}</span>
                  {t.thumbnail ? (
                    <img src={t.thumbnail} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded bg-spotify-highlight flex items-center justify-center flex-shrink-0">
                      <Music className="w-4 h-4 text-spotify-subtext" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-white truncate">{t.title}</p>
                    <p className="text-[10px] text-spotify-subtext truncate">{t.artist}</p>
                  </div>
                  {t.durationSeconds > 0 && (
                    <span className="text-[10px] text-spotify-subtext font-mono">
                      {Math.floor(t.durationSeconds / 60)}:{String(t.durationSeconds % 60).padStart(2, '0')}
                    </span>
                  )}
                </div>
              ))}
              {preview.tracks?.length > 20 && (
                <p className="text-center text-[10px] text-spotify-subtext py-1">
                  ועוד {preview.tracks.length - 20} שירים נוספים...
                </p>
              )}
            </div>

            <button
              onClick={handleSave}
              className="w-full bg-spotify-green hover:bg-spotify-green-hover text-black font-black py-3 rounded-lg text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-spotify-green/20"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>שמור פלייליסט זה בספרייה שלי</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
