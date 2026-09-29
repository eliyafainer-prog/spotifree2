import React, { useState } from 'react';
import { X, DownloadCloud, Loader2, Music, Check, Sparkles, ListPlus, Link2 } from 'lucide-react';
import { importPlaylistFromUrl } from '../services/spotifyImport';
import { searchTracks } from '../services/directAudio';

export function ImportModal({ isOpen, onClose, onPlaylistImported }) {
  const [tab, setTab] = useState('text'); // Default to fast text importer
  const [url, setUrl] = useState('');
  const [textList, setTextList] = useState('');
  const [playlistTitle, setPlaylistTitle] = useState('שירים שאני אוהב');
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
    setProgressMsg('מפענח קישור...');
    setPreview(null);

    try {
      const result = await importPlaylistFromUrl(url.trim());
      setPreview(result);
    } catch (err) {
      setError(err.message || 'נכשל פיענוח הקישור. מומלץ להשתמש בלשונית הדבקת שמות שירים.');
    } finally {
      setLoading(false);
      setProgressMsg('');
    }
  };

  const handleFetchTextList = async (e) => {
    e?.preventDefault();
    const lines = textList
      .split('\n')
      .map((l) => l.replace(/^\d+[\.\)\-:]\s*/, '').trim())
      .filter((l) => l.length > 1);

    if (lines.length === 0) {
      setError('נא להזין או להדביק לפחות שם שיר אחד');
      return;
    }

    setLoading(true);
    setError('');
    setPreview(null);

    try {
      const foundTracks = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        setProgressMsg(`מחפש שיר ${i + 1} מתוך ${lines.length}: "${line.substring(0, 25)}..."`);
        const results = await searchTracks(line, 1);
        if (results && results.length > 0) {
          foundTracks.push(results[0]);
        }
      }

      if (foundTracks.length === 0) {
        throw new Error('לא נמצאו שירים תואמים לשמות שהוזנו');
      }

      setPreview({
        id: `pl_text_${Date.now()}`,
        title: playlistTitle.trim() || 'שירים שאני אוהב',
        cover: foundTracks[0]?.thumbnail || '',
        type: 'Custom Playlist',
        tracks: foundTracks
      });
    } catch (err) {
      setError(err.message || 'נכשל איתור השירים ברשימה');
    } finally {
      setLoading(false);
      setProgressMsg('');
    }
  };

  const handleSave = () => {
    if (!preview) return;

    const newPlaylist = {
      id: `pl_${Date.now()}`,
      title: preview.title,
      cover: preview.cover,
      type: preview.type,
      tracks: preview.tracks,
      createdAt: Date.now()
    };

    onPlaylistImported(newPlaylist);
    onClose();
    setUrl('');
    setTextList('');
    setPreview(null);
  };

  const sampleYouTubeUrl = 'https://www.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-spotify-dark border border-spotify-border rounded-xl max-w-lg w-full p-6 flex flex-col gap-4 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-spotify-green/20 text-spotify-green flex items-center justify-center">
              <DownloadCloud className="w-4 h-4" />
            </div>
            <h2 className="font-bold text-lg text-white">ייבוא פלייליסט</h2>
          </div>
          <button
            onClick={onClose}
            className="text-spotify-subtext hover:text-white p-1 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-2 p-1 bg-spotify-elevated rounded-lg border border-spotify-border">
          <button
            onClick={() => { setTab('text'); setError(''); setPreview(null); }}
            className={`flex-1 py-2 px-3 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              tab === 'text' ? 'bg-spotify-green text-black shadow-md' : 'text-spotify-subtext hover:text-white'
            }`}
          >
            <ListPlus className="w-4 h-4" />
            <span>הדבקת שמות שירים (מומלץ)</span>
          </button>
          <button
            onClick={() => { setTab('link'); setError(''); setPreview(null); }}
            className={`flex-1 py-2 px-3 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              tab === 'link' ? 'bg-spotify-green text-black shadow-md' : 'text-spotify-subtext hover:text-white'
            }`}
          >
            <Link2 className="w-4 h-4" />
            <span>קישור יוטיוב / ספוטיפיי</span>
          </button>
        </div>

        {/* Tab 1 (Default): Fast Text List Import */}
        {tab === 'text' && (
          <form onSubmit={handleFetchTextList} className="flex flex-col gap-3">
            <div>
              <label className="text-xs font-semibold text-spotify-subtext block mb-1">
                שם הפלייליסט:
              </label>
              <input
                type="text"
                value={playlistTitle}
                onChange={(e) => setPlaylistTitle(e.target.value)}
                placeholder="שירים שאני אוהב"
                className="w-full bg-spotify-elevated text-white text-sm px-3.5 py-2.5 rounded-lg border border-spotify-border focus:border-spotify-green focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-spotify-subtext block mb-1">
                הדבק כאן את שמות השירים שלך (שיר אחד בכל שורה):
              </label>
              <textarea
                rows={6}
                value={textList}
                onChange={(e) => setTextList(e.target.value)}
                placeholder={'עומר אדם - הכל וכלום בבת אחת\nIcona Pop - THIS IS\nMichael Jackson - Thriller\nפסטיגל 2005 - גיבורי הממלכה\nפסטיגל 2008'}
                className="w-full bg-spotify-elevated text-white text-sm p-3.5 rounded-lg border border-spotify-border focus:border-spotify-green focus:outline-none font-sans"
              />
              <p className="text-[11px] text-spotify-subtext mt-1">
                💡 טיפ: העתק רשימת שירים מספוטיפיי, ווטסאפ או פתקים – המערכת תאתר ותייבא את כולם אוטומטית!
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !textList.trim()}
              className="w-full bg-spotify-green hover:bg-spotify-green-hover disabled:opacity-50 text-black font-bold py-3 rounded-lg text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-spotify-green/20"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{progressMsg || 'מאתר ומייבא שירים...'}</span>
                </>
              ) : (
                'חפש וצור פלייליסט עכשיו'
              )}
            </button>
          </form>
        )}

        {/* Tab 2: URL Import (YouTube & Spotify) */}
        {tab === 'link' && (
          <form onSubmit={handleFetchLink} className="flex flex-col gap-3">
            <label className="text-xs font-semibold text-spotify-subtext">
              הדבק קישור מיוטיוב או ספוטיפיי:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="https://www.youtube.com/playlist?list=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="flex-1 bg-spotify-elevated text-white text-sm px-3.5 py-2.5 rounded-lg border border-spotify-border focus:border-spotify-green focus:outline-none transition-colors"
              />
              <button
                type="submit"
                disabled={loading || !url.trim()}
                className="bg-spotify-green hover:bg-spotify-green-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-lg text-sm transition-all flex items-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'טען'}
              </button>
            </div>

            <div className="text-[11px] text-spotify-subtext flex items-center gap-1.5 mt-1">
              <Sparkles className="w-3.5 h-3.5 text-spotify-green" />
              <span>דוגמת קישור יוטיוב:</span>
              <button
                type="button"
                onClick={() => setUrl(sampleYouTubeUrl)}
                className="text-spotify-green underline hover:text-spotify-green-hover truncate max-w-xs"
              >
                Pop Music Playlist (YouTube)
              </button>
            </div>

            <div className="p-2.5 bg-white/5 rounded-lg border border-white/10 text-[11px] text-spotify-subtext">
              📌 שים לב: פלייליסטים אישיים בספוטיפיי מוגנים על ידי ספוטיפיי מחילוץ חיצוני. עבור ספוטיפיי, מומלץ להשתמש בלשונית <strong>הדבקת שמות שירים</strong>!
            </div>
          </form>
        )}

        {/* Error message */}
        {error && (
          <div className="p-3 bg-red-900/30 border border-red-500/40 rounded-lg text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Preview of loaded playlist */}
        {preview && (
          <div className="p-4 bg-spotify-elevated rounded-lg border border-spotify-border flex flex-col gap-3">
            <div className="flex items-center gap-3">
              {preview.cover ? (
                <img src={preview.cover} alt="" className="w-14 h-14 rounded-md object-cover shadow-md" />
              ) : (
                <div className="w-14 h-14 rounded-md bg-spotify-highlight flex items-center justify-center text-spotify-subtext">
                  <Music className="w-6 h-6" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-white text-base truncate">{preview.title}</h3>
                <p className="text-xs text-spotify-green font-medium">
                  זוהו {preview.tracks?.length || 0} שירים ({preview.type})
                </p>
              </div>
            </div>

            <button
              onClick={handleSave}
              className="w-full bg-spotify-green hover:bg-spotify-green-hover text-black font-bold py-2.5 rounded-lg text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-spotify-green/20"
            >
              <Check className="w-4 h-4" />
              <span>שמור פלייליסט זה בספרייה שלי</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

