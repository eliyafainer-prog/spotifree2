import React, { useState } from 'react';
import { X, DownloadCloud, Loader2, Music, Check, Sparkles, ListPlus, Link2, ClipboardPaste, AlertCircle } from 'lucide-react';
import { importPlaylistFromUrl, importPlaylistFromTextList } from '../services/spotifyImport';

export function ImportModal({ isOpen, onClose, onPlaylistImported }) {
  const [tab, setTab] = useState('link'); // 'link' | 'ai'
  const [url, setUrl] = useState('');
  const [textList, setTextList] = useState('');
  const [playlistTitle, setPlaylistTitle] = useState('');
  const [spotifyCover, setSpotifyCover] = useState('');
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(null);

  if (!isOpen) return null;

  const handleFetchLink = async (e) => {
    e?.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError('');
    setNotice('');
    setProgressMsg('מפענח קישור ומייבא שירים...');
    setPreview(null);

    try {
      const result = await importPlaylistFromUrl(url.trim());
      
      // If Spotify oEmbed succeeded but internal tracks require manual/text list due to Spotify CORS
      if (result.requiresTrackList) {
        setPlaylistTitle(result.title);
        if (result.cover) setSpotifyCover(result.cover);
        setTab('ai');
        setNotice(`✨ זיהינו בהצלחה את הפלייליסט: "${result.title}"! בגלל אבטחת ספוטיפיי בדפדפן, הדבק כעת את שמות השירים וה-AI ימצא את העטיפות והשמע הרשמיים.`);
        return;
      }

      setPreview(result);
    } catch (err) {
      setError(err.message || 'נכשל פיענוח הקישור. ודא שהפלייליסט ציבורי ותקין.');
    } finally {
      setLoading(false);
      setProgressMsg('');
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setTextList(prev => prev ? `${prev}\n${text}` : text);
        }
      }
    } catch (e) {
      console.warn('Clipboard access not allowed:', e);
    }
  };

  const handleFetchSmartList = async (e) => {
    e?.preventDefault();
    if (!textList.trim()) {
      setError('נא להזין או להדביק לפחות שם שיר אחד');
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');
    setPreview(null);

    try {
      const result = await importPlaylistFromTextList(
        playlistTitle.trim() || 'פלייליסט מיובא',
        textList,
        (current, total, currentName) => {
          setProgressMsg(`מעבד שיר ${current} מתוך ${total}: "${currentName.substring(0, 28)}..."`);
        }
      );

      if (spotifyCover && !result.cover) {
        result.cover = spotifyCover;
      }

      setPreview(result);
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
      title: preview.title || 'פלייליסט חדש',
      cover: preview.cover || '',
      type: preview.type || 'Custom Playlist',
      tracks: preview.tracks || [],
      createdAt: Date.now()
    };

    onPlaylistImported(newPlaylist);
    onClose();
    setUrl('');
    setTextList('');
    setPlaylistTitle('');
    setSpotifyCover('');
    setPreview(null);
  };

  const sampleYouTubeUrl = 'https://www.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj';
  const sampleSpotifyUrl = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-spotify-dark border border-spotify-border rounded-xl max-w-lg w-full p-6 flex flex-col gap-4 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-spotify-green/20 text-spotify-green flex items-center justify-center shadow">
              <DownloadCloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-white">ייבוא פלייליסט חכם</h2>
              <p className="text-[11px] text-spotify-subtext">ייבוא שירים עם שמות, עטיפות ואורכים מדויקים של ספוטיפיי</p>
            </div>
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
            onClick={() => { setTab('link'); setError(''); setNotice(''); setPreview(null); }}
            className={`flex-1 py-2 px-3 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              tab === 'link' ? 'bg-spotify-green text-black shadow-md' : 'text-spotify-subtext hover:text-white'
            }`}
          >
            <Link2 className="w-4 h-4" />
            <span>הזנת קישור (URL)</span>
          </button>
          <button
            onClick={() => { setTab('ai'); setError(''); setNotice(''); setPreview(null); }}
            className={`flex-1 py-2 px-3 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              tab === 'ai' ? 'bg-spotify-green text-black shadow-md' : 'text-spotify-subtext hover:text-white'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>ייבוא חכם AI / טקסט</span>
          </button>
        </div>

        {/* Notice Banner */}
        {notice && (
          <div className="p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-lg text-xs text-emerald-300 flex items-start gap-2 animate-fadeIn">
            <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>{notice}</span>
          </div>
        )}

        {/* Tab 1: Link Import */}
        {tab === 'link' && (
          <form onSubmit={handleFetchLink} className="flex flex-col gap-3">
            <label className="text-xs font-semibold text-spotify-subtext">
              הדבק כאן קישור לפלייליסט מספוטיפיי או מיוטיוב:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="https://open.spotify.com/playlist/... או יוטיוב"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoFocus
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

            {loading && progressMsg && (
              <p className="text-xs text-spotify-green animate-pulse flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{progressMsg}</span>
              </p>
            )}

            <div className="text-[11px] text-spotify-subtext flex flex-wrap items-center gap-2 mt-1">
              <Sparkles className="w-3.5 h-3.5 text-spotify-green" />
              <span>דוגמאות:</span>
              <button
                type="button"
                onClick={() => setUrl(sampleSpotifyUrl)}
                className="text-spotify-green underline hover:text-spotify-green-hover"
              >
                Today's Top Hits (Spotify)
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => setUrl(sampleYouTubeUrl)}
                className="text-spotify-green underline hover:text-spotify-green-hover"
              >
                Top Pop Playlist (YouTube)
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: Smart AI / Text List Import */}
        {tab === 'ai' && (
          <form onSubmit={handleFetchSmartList} className="flex flex-col gap-3">
            <div>
              <label className="text-xs font-semibold text-spotify-subtext block mb-1">
                שם הפלייליסט:
              </label>
              <input
                type="text"
                value={playlistTitle}
                onChange={(e) => setPlaylistTitle(e.target.value)}
                placeholder="למשל: הלהיטים שלי, Party 2026..."
                className="w-full bg-spotify-elevated text-white text-sm px-3.5 py-2.5 rounded-lg border border-spotify-border focus:border-spotify-green focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-spotify-subtext">
                  הדבק שמות שירים (או קישורי שירים מספוטיפיי):
                </label>
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  className="text-[11px] text-spotify-green hover:underline flex items-center gap-1"
                >
                  <ClipboardPaste className="w-3 h-3" />
                  <span>הדבק מהלוח</span>
                </button>
              </div>
              <textarea
                rows={5}
                value={textList}
                onChange={(e) => setTextList(e.target.value)}
                placeholder={'עדן חסון - שקיעות אדומות\nחנן בן ארי - הלוואי\nColdplay - Viva La Vida\nאו העתק רשימה ישירות מספוטיפיי'}
                className="w-full bg-spotify-elevated text-white text-sm p-3.5 rounded-lg border border-spotify-border focus:border-spotify-green focus:outline-none font-sans"
              />
              <p className="text-[10px] text-spotify-subtext/80 mt-1">
                💡 המנגנון מנקה אוטומטית מספור (1., 2.), מזהה אמנים, ומצמיד עטיפות HD ואורכי שירים רשמיים.
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
                  <span className="text-xs truncate max-w-xs">{progressMsg || 'מאתר ומייבא שירים ב-AI...'}</span>
                </>
              ) : (
                'חפש וצור פלייליסט עם עטיפות רשמיות'
              )}
            </button>
          </form>
        )}

        {/* Error message */}
        {error && (
          <div className="p-3 bg-red-900/30 border border-red-500/40 rounded-lg text-xs text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Preview of loaded playlist */}
        {preview && (
          <div className="p-4 bg-spotify-elevated rounded-lg border border-spotify-border flex flex-col gap-3 animate-fadeIn">
            <div className="flex items-center gap-3">
              {preview.cover ? (
                <img src={preview.cover} alt="" className="w-14 h-14 rounded-md object-cover shadow-md flex-shrink-0" />
              ) : (
                <div className="w-14 h-14 rounded-md bg-spotify-highlight flex items-center justify-center text-spotify-subtext flex-shrink-0">
                  <Music className="w-6 h-6" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-white text-base truncate">{preview.title}</h3>
                <p className="text-xs text-spotify-green font-medium">
                  זוהו {preview.tracks?.length || 0} שירים עם מטא-דאטה ועטיפות מלאות!
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
