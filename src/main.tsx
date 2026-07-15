import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import InviteLandingPage from './pages/InviteLandingPage';
import { LanguageProvider } from './i18n';

const isInviteRoute =
  typeof window !== 'undefined' &&
  window.location.pathname.replace(/\/+$/, '') === '/invite';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* ignore */
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      {isInviteRoute ? <InviteLandingPage /> : <App />}
    </LanguageProvider>
  </StrictMode>,
);
