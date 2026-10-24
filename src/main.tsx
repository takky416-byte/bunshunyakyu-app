import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './mobile-layout.css'
import './experience.css'
const AnalyticsAdmin = lazy(() => import('./AnalyticsAdmin'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="admin-loading">読み込み中…</div>}>
      {/^\/admin\/?$/.test(window.location.pathname) ? (
        <AnalyticsAdmin />
      ) : (
        <App />
      )}
    </Suspense>
  </StrictMode>,
)
