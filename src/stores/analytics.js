/*
 * Frontend analytics tracker.
 *
 * Sends events to the backend `/api/track` endpoint. All calls are
 * fire-and-forget: failures are swallowed so analytics can never break the
 * user experience.
 *
 * Usage:
 *   import { track, trackPageView } from '../stores/analytics.js';
 *   track('search', { metadata: { query: 'cinta' } });
 *   trackPageView();   // typically called from svelte-spa-router's
 *                      //   wb-routestarted listener
 *
 * To avoid spamming the backend with duplicate `page_view` events when the
 * router re-renders the same hash, we de-dupe on the path string.
 */

let lastPageViewPath = null;

/**
 * Send a single event. Quietly drops on any failure.
 * @param {string} eventType
 * @param {object} [extra]
 * @param {string} [extra.provider]
 * @param {string} [extra.drama_id]
 * @param {string} [extra.episode_id]
 * @param {string} [extra.path]
 * @param {object} [extra.metadata]
 */
export function track(eventType, extra = {}) {
    if (!eventType) return;
    const payload = {
        event_type: eventType,
        provider: extra.provider || null,
        drama_id: extra.drama_id || null,
        episode_id: extra.episode_id || null,
        path: extra.path || (typeof location !== 'undefined' ? location.hash || location.pathname : null),
        metadata: extra.metadata || null
    };

    try {
        // Prefer sendBeacon for unload-time events (video unmount, page hide).
        // It's cheap, non-blocking, and survives navigation. Fall back to
        // fetch() with keepalive when Beacon isn't available or rejects.
        const body = JSON.stringify(payload);
        const blob = new Blob([body], { type: 'application/json' });
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
            const ok = navigator.sendBeacon('/api/track', blob);
            if (ok) return;
        }
        fetch('/api/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
            credentials: 'same-origin'
        }).catch(() => { /* swallow */ });
    } catch (_) {
        /* swallow */
    }
}

/**
 * Convenience helper for SPA route changes. De-duplicates on the path string
 * to avoid double-counting when Svelte rerenders the route.
 */
export function trackPageView(path) {
    const p = path || (typeof location !== 'undefined' ? location.hash || location.pathname : null);
    if (p && p === lastPageViewPath) return;
    lastPageViewPath = p;
    track('page_view', { path: p });
}

/**
 * Throttled progress tracker, intended for the video player's `timeupdate`
 * handler. Emits `video_progress` at most once every `intervalMs` per
 * (provider, drama, episode) tuple.
 */
const progressLastSent = new Map();
export function trackVideoProgress({ provider, drama_id, episode_id, position }, intervalMs = 30000) {
    const key = `${provider}:${drama_id}:${episode_id}`;
    const now = Date.now();
    const last = progressLastSent.get(key) || 0;
    if (now - last < intervalMs) return;
    progressLastSent.set(key, now);
    track('video_progress', {
        provider,
        drama_id,
        episode_id,
        metadata: { position_seconds: Math.floor(position || 0) }
    });
}
