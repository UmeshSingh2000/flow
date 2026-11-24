import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './ui/App';
import { SharedApp } from './ui/SharedApp';
import { applyTheme, readTheme } from './state/store';
import { initShareStore } from './state/shareStore';
import { initCommandBridge, initThemeBridge } from './ui/vscodeBridge';

const share = window.__FLOW_SHARE__;
applyTheme(share?.theme ?? readTheme());

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found.');
}

if (share) {
  // Guest page served by the sharer's LAN server: read-only, no local storage.
  createRoot(container).render(
    <StrictMode>
      <SharedApp bootstrap={share} />
    </StrictMode>,
  );
} else {
  initThemeBridge();
  initShareStore();
  initCommandBridge();
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
