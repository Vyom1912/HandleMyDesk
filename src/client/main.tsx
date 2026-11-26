import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './context/AppContext';
import { OwnerConsole } from './components/owner/OwnerConsole';
import { ResetPasswordView } from './components/views/ResetPasswordView';
import { isOwnerSession } from './services/api';
import { applyTheme, storedTheme } from './services/appearance';
import './index.css';
import { registerServiceWorker } from './services/push';

// Before the first paint, so dark mode doesn't flash white
applyTheme(storedTheme());
registerServiceWorker();

// A link from the "Forgot password?" email
const reset = window.location.hash.match(/^#\/reset\/([\w-]{20,100})$/);

// The HandleMyDesk owner works in the owner console; everyone else in their office's workspace
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {reset ? (
      <ResetPasswordView token={reset[1]} />
    ) : isOwnerSession() ? (
      <OwnerConsole />
    ) : (
      <AppProvider>
        <App />
      </AppProvider>
    )}
  </React.StrictMode>
);
