import { useEffect, useState } from 'react';
import { DashboardPage } from './pages/DashboardPage';
import { SnapshotPage } from './pages/SnapshotPage';
import { UploadPage } from './pages/UploadPage';
import { AppProvider, useApp } from './state';

export const APP_NAME = 'CARMA';

// Hash routes keep GitHub Pages happy without a server: #/upload, #/dashboard. #/snapshot?… is only opened by
// scripts/snapshots.mjs (nothing in the app links to it).
function useRoute(): string {
  const [route, setRoute] = useState(() => location.hash.replace(/^#/, '') || '/upload');
  useEffect(() => {
    const onHash = () => setRoute(location.hash.replace(/^#/, '') || '/upload');
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

export function navigate(route: string) {
  location.hash = route;
}

function Routes() {
  const route = useRoute();
  const [path, query = ''] = route.split('?');
  const { result } = useApp();
  // Production has no 1D vs 2D comparison: an old /compare link opens the dashboard.
  const page = result && (path === '/dashboard' || path === '/compare') ? 'dashboard' : result && path === '/snapshot' ? 'snapshot' : 'upload';
  // Each page opens at the top (the upload page is usually scrolled down to Analyze).
  useEffect(() => { scrollTo(0, 0); }, [page]);
  useEffect(() => {
    document.title = `${APP_NAME} · ${page === 'dashboard' || page === 'snapshot' ? 'Analysis Dashboard' : 'Import Network Data'}`;
    if ((path === '/dashboard' || path === '/compare' || path === '/snapshot') && !result) navigate('/upload');
  }, [page, path, result]);
  if (page === 'snapshot') return <SnapshotPage key={query} params={new URLSearchParams(query)} />;
  return page === 'dashboard' ? <DashboardPage /> : <UploadPage />;
}

export function App() {
  return (
    <AppProvider>
      <Routes />
    </AppProvider>
  );
}
