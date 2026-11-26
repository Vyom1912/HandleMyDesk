import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './context/AppContext';
import { OwnerConsole } from './components/owner/OwnerConsole';
import { isOwnerSession } from './services/api';
import './index.css';
import { registerServiceWorker } from './services/push';

registerServiceWorker();

// The HandleMyDesk owner works in the owner console; everyone else in their office's workspace
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isOwnerSession() ? (
      <OwnerConsole />
    ) : (
      <AppProvider>
        <App />
      </AppProvider>
    )}
  </React.StrictMode>
);
