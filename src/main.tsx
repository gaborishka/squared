import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const rootElement = document.getElementById('root');
const bootStatus = document.getElementById('boot-status');

if (!rootElement) {
  throw new Error('Missing root element.');
}

try {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  bootStatus?.remove();
} catch (error) {
  if (bootStatus) {
    bootStatus.textContent = 'Squared could not start the interface. Please reopen the app.';
  }
  throw error;
}
