'use client';

import { useEffect, useState } from 'react';

/**
 * ServiceWorkerRegistrar — mounts /sw.js in production, reports cache state.
 *
 * Zero UI (one invisible ping when the cache is warm). Placed once in
 * app/layout.jsx, this component:
 *   - registers /sw.js (production only — dev keeps Next.js HMR honest);
 *   - fires CustomEvent('printx:sw-status', { detail: 'offline-ready' })
 *     once the worker controls the page, for an offline-ready hint;
 *   - unregisters any legacy worker scripts from older deploys;
 *   - asks a waiting worker to skipWaiting (faster prod updates).
 *
 * Dev: in `npm run dev` this component is a no-op, so webpack-hmr streams
 * and per-keystroke recompiles are never intercepted by a cache layer.
 */
export default function ServiceWorkerRegistrar() {
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    // Production-only registration; leave dev origins untouched.
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    let cancelled = false;
    let reg = null;

    const bootstrap = async () => {
      try {
        // Cleanup: an older deploy's worker must not linger beside the new one.
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          regs
            .filter((r) => {
              const url = r?.active?.scriptURL || r?.installing?.scriptURL || '';
              return url.includes('/service-worker.js');
            })
            .map((r) => r.unregister())
        );

        reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

        // Prod update flow: when a new worker is waiting while a controller
        // is active, activate it at once (assets are content-hashed, so an
        // immediate swap is safe).
        reg.addEventListener('updatefound', () => {
          const worker = reg?.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
            if (worker.state === 'activated' && !cancelled) {
              setOfflineReady(true);
              window.dispatchEvent(new CustomEvent('printx:sw-status', { detail: 'offline-ready' }));
            }
          });
        });

        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        if (reg.active && !cancelled) {
          setOfflineReady(true);
          window.dispatchEvent(new CustomEvent('printx:sw-status', { detail: 'offline-ready' }));
        }
      } catch (err) {
        console.warn('[sw] registration skipped:', err?.message || err);
      }
    };

    bootstrap();
    // Re-check for a new worker when the tab wakes (PWA-style freshness).
    const onVisible = () => {
      if (document.visibilityState === 'visible') reg?.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      // NOTE: never unregister on unmount — one worker serves the whole app.
    };
  }, []);

  // Invisible until ready; then a 0-height live region announces cache state
  // for assistive tech without drawing any visual attention.
  return (
    <span
      aria-live="polite"
      style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
      data-sw-ready={offlineReady ? 'true' : 'false'}
    />
  );
}
