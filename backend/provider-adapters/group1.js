// Group 1: bilitv, dramabite, rapidtv
// All three share the simple `id/title/cover/episodes` shape and
// `/api/v1/dramas/:id/episode/:ep` style endpoints.

import { compact, normalizeItem, normalizeSubtitle, filterValid } from './_helpers.js';

// ----- bilitv -----
// Base: /bilitv/api/v1
// list shape: { id, title, cover, episodes }
// detail: { id, title, cover, description, episodes:[{id, number, free}] }
// play: { id, number, title, video, qualities:{480,720,1080}, isLocked }
// subtitles: /subtitle/:shortId/:episode (optional, often "Proxy error")
export const bilitv = {
    name: 'BiliTV',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('bilitv', 'home', { page: 1, limit: 30, lang });
        const list = data?.dramas || data?.data?.dramas || [];
        return { dramas: filterValid(list.map(normalizeItem)) };
    },
    async categories() {
        return { categories: [] };
    },
    async categoryContent({ fetchApi, lang }) {
        const data = await fetchApi('bilitv', 'dramas', { page: 1, size: 30, lang });
        const list = Array.isArray(data) ? data : (data?.data || data?.dramas || []);
        return { dramas: filterValid(list.map(normalizeItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('bilitv', 'search', { q, lang });
        const list = Array.isArray(data) ? data : (data?.data || []);
        return { dramas: filterValid(list.map(normalizeItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('bilitv', `drama/${id}`, { lang });
        const d = data?.data || data || {};
        return {
            id: String(d.id || id),
            title: d.title || '',
            poster: d.cover || '',
            intro: d.description || 'Deskripsi tidak tersedia.',
            totalEpisodes: (d.episodes || []).length || d.total_episodes || 0,
            tags: d.tags || []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const data = await fetchApi('bilitv', `drama/${dramaId}/episode/${episodeId}`, { lang });
        const d = data?.data || data || {};
        const qualities = {};
        if (d.qualities) {
            for (const [k, v] of Object.entries(d.qualities)) qualities[`${k}p`] = v;
        }
        const subs = [];
        try {
            const sub = await fetchApi('bilitv', `subtitle/${dramaId}/${episodeId}`, { lang });
            const list = sub?.data || sub?.subtitles || (Array.isArray(sub) ? sub : []);
            for (const s of list) {
                const n = normalizeSubtitle({
                    language: s.language || s.lang || s.code,
                    label: s.name || s.label || s.display_name,
                    url: s.url || s.subtitle
                });
                if (n) subs.push(n);
            }
        } catch (_) { /* subtitles optional */ }
        return {
            source: d.video || qualities['1080p'] || qualities['720p'] || qualities['480p'] || '',
            qualities,
            subtitles: subs
        };
    }
};

// ----- dramabite -----
// Base: /dramabite/api/v1
// Lists are bare arrays. detail: { id, cover, episodes:[{id, number, title, free}] }
// play: { id, number, title, video, validFor }
export const dramabite = {
    name: 'DramaBite',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('dramabite', 'foryou', { page: 0, lang });
        const list = Array.isArray(data) ? data : (data?.data || []);
        return { dramas: filterValid(list.map(normalizeItem)) };
    },
    async categories() {
        return {
            categories: [
                { id: 'foryou', name: 'For You' },
                { id: 'hot', name: 'Hot' },
                { id: 'recommend', name: 'Rekomendasi' },
                { id: 'dramas', name: 'Semua' }
            ]
        };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const path = ['foryou', 'hot', 'recommend', 'dramas'].includes(id) ? id : 'dramas';
        const data = await fetchApi('dramabite', path, { page: 0, lang });
        const list = Array.isArray(data) ? data : (data?.data || []);
        return { dramas: filterValid(list.map(normalizeItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('dramabite', 'search', { q, page: 0, lang });
        const list = Array.isArray(data) ? data : (data?.data || []);
        return { dramas: filterValid(list.map(normalizeItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('dramabite', `drama/${id}`, { lang });
        const d = data?.data || data || {};
        return {
            id: String(d.id || id),
            title: d.title || (d.episodes?.[0]?.title?.replace(/-\d+$/, '') || ''),
            poster: d.cover || '',
            intro: d.description || 'Deskripsi tidak tersedia.',
            totalEpisodes: (d.episodes || []).length || 0,
            tags: []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const data = await fetchApi('dramabite', `drama/${dramaId}/episode/${episodeId}`, { lang });
        const d = data?.data || data || {};
        return {
            source: d.video || '',
            qualities: {},
            subtitles: []
        };
    }
};

// ----- rapidtv -----
// Base: /rapidtv/api/v1
// list: bare array of { id?/dramaId, title, cover, episodes }
// detail: { id, title, cover, description, episodes:[{episode, episodeId, videos:[{quality, url}]}] }
// stream is embedded inside `episodes` array (no separate stream endpoint).
export const rapidtv = {
    name: 'RapidTV',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('rapidtv', 'dramas', { page: 1, lang });
        const list = Array.isArray(data) ? data : (data?.data || []);
        return { dramas: filterValid(list.map(normalizeItem)) };
    },
    async categories() {
        return { categories: [] };
    },
    async categoryContent(ctx) {
        return rapidtv.home(ctx);
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('rapidtv', 'search', { q, lang });
        const list = Array.isArray(data) ? data : (data?.data || []);
        return { dramas: filterValid(list.map(normalizeItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('rapidtv', `dramas/${id}`, { lang });
        const d = data?.data || data || {};
        return {
            id: String(d.id || id),
            title: d.title || '',
            poster: d.cover || '',
            intro: d.description || 'Deskripsi tidak tersedia.',
            totalEpisodes: d.totalEpisodes || (d.episodes || []).length || 0,
            tags: d.tags || []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const data = await fetchApi('rapidtv', `dramas/${dramaId}/episodes`, { lang });
        const list = Array.isArray(data) ? data : (data?.data || []);
        const ep = list.find(e => String(e.episode) === String(episodeId)) || list[parseInt(episodeId) - 1];
        const videos = ep?.videos || [];
        const qualities = {};
        for (const v of videos) {
            const key = (v.quality || '').toLowerCase().replace('p', '') + 'p';
            if (v.url) qualities[key] = v.url;
        }
        return {
            source: qualities['1080p'] || qualities['720p'] || qualities['540p'] || qualities['480p'] || qualities['360p'] || (videos[0]?.url || ''),
            qualities,
            subtitles: []
        };
    }
};
