import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { useGameStore } from './store.js';
import { installRealSound } from './services/sfxService.js';

// Sprint 5 — install the real card/chip sample backend (MP3s in
// public/assets/sfx/). Best-effort; falls back to the synth blips when a
// sample is missing or audio is unavailable. Safe under Node/tests (no-op).
installRealSound();

// Wire up socket event listeners once
useGameStore.getState().connect();

const root = createRoot(document.getElementById('root'));
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
