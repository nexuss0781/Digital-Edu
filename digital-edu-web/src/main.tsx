import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Providers } from '@/components/layout/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import App from '@/App';
import '@/styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Providers>
        <ToastProvider>
          <App />
        </ToastProvider>
      </Providers>
    </BrowserRouter>
  </StrictMode>,
);
