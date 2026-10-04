import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Purge any legacy cached video IDs from previous builds to eliminate cached monetized clips
try {
  if (localStorage.getItem('spotifree_app_version') !== '4.0.0') {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('spotifree_yt_') || key.startsWith('spotifree_stream_')) {
        localStorage.removeItem(key);
      }
    });
    localStorage.setItem('spotifree_app_version', '4.0.0');
  }
} catch (e) {}

// Register Service Worker with correct base URL and auto-update
if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swUrl).then(reg => {
      reg.update();
      reg.onupdatefound = () => {
        const installingWorker = reg.installing;
        if (installingWorker) {
          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Automatically apply new clean version
              window.location.reload();
            }
          };
        }
      };
    }).catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
