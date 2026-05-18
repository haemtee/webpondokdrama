import { writable } from 'svelte/store';

// Persisted subtitle preferences. Shared across episodes/sessions so the
// user does not have to reconfigure every time they open a video.
//
// Shape:
//   {
//     enabled:  bool                       // captions on/off
//     language: string | null              // chosen track language (e.g. "id-id")
//     fontSize: number                     // px
//     position: number                     // 0..100 vertical % from top
//   }

const STORAGE_KEY = 'dracin_subtitle_prefs';

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

const defaults = {
    enabled: true,
    language: null,
    fontSize: 18,
    position: 88
};

export const subtitlePrefs = writable({ ...defaults, ...(load() || {}) });

subtitlePrefs.subscribe((value) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (_) { /* ignore quota errors */ }
});
