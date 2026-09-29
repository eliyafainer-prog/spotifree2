const DB_NAME = 'SpotiFreeOfflineDB_v2';
const DB_VERSION = 1;
const STORE_NAME = 'offline_tracks';

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      return reject(new Error('IndexedDB is not supported on this device.'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('title', 'title', { unique: false });
        store.createIndex('artist', 'artist', { unique: false });
        store.createIndex('downloadedAt', 'downloadedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveTrackOffline(track, audioBlob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      thumbnail: track.thumbnail,
      durationSeconds: track.durationSeconds,
      audioBlob: audioBlob,
      sizeBytes: audioBlob.size,
      downloadedAt: Date.now()
    };

    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

export async function getOfflineTrack(trackOrId) {
  if (!trackOrId) return null;
  const id = typeof trackOrId === 'string' ? trackOrId : trackOrId.id;
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => {
        if (request.result) return resolve(request.result);

        if (typeof trackOrId === 'object' && trackOrId.title) {
          const allReq = store.getAll();
          allReq.onsuccess = () => {
            const all = allReq.result || [];
            const match = all.find(item =>
              item.title?.toLowerCase().trim() === trackOrId.title?.toLowerCase().trim() &&
              (!trackOrId.artist || item.artist?.toLowerCase().trim() === trackOrId.artist?.toLowerCase().trim())
            );
            resolve(match || null);
          };
          allReq.onerror = () => resolve(null);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function getAllOfflineTracks() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function deleteOfflineTrack(id) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to delete offline track:', err);
    return false;
  }
}

export async function isTrackDownloaded(trackOrId) {
  const track = await getOfflineTrack(trackOrId);
  return !!track;
}

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export async function getOfflineStorageUsage() {
  const tracks = await getAllOfflineTracks();
  const totalBytes = tracks.reduce((acc, t) => acc + (t.sizeBytes || 0), 0);
  return {
    totalBytes,
    formatted: formatBytes(totalBytes),
    count: tracks.length
  };
}

