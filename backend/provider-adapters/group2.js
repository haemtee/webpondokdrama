// Group 2: dramawave + freereels (mydramawave family)
// They share `external_audio_h264_m3u8`, `external_audio_h265_m3u8`, and a
// rich `subtitle_list` with srt + sometimes vtt URLs.

import { normalizeSubtitle, filterValid } from './_helpers.js';

function dwItem(d) {
    // dramawave / freereels list items use `key` (a short hash like
    // "bwl0UcvGOW") as the canonical id used by detail / play endpoints.
    // Some sectioned wrappers also expose a numeric `id`, but that's the
    // *internal* row id and the play endpoint will 404 on it. Prefer key.
    return {
        id: String(d.key || d.id || ''),
        title: d.name || d.title || '',
        poster: d.cover || '',
        episode_count: d.episode_count || d.episodeCount || '?'
    };
}


function dwSubs(list) {
    const out = [];
    for (const s of list || []) {
        // Prefer .vtt if available, fallback to .srt.
        const url = s.vtt || s.subtitle || s.url;
        const n = normalizeSubtitle({
            language: s.language || s.lang || s.code,
            label: s.display_name || s.name || s.label || s.language,
            url,
            format: s.vtt ? 'vtt' : 'srt'
        });
        if (n) out.push(n);
    }
    return out;
}

function dwStreamFromEpisode(d) {
    const url = d.external_audio_h264_m3u8 || d.video_url || d.m3u8_url || d.external_audio_h265_m3u8 || '';
    return {
        source: url,
        qualities: {},
        subtitles: dwSubs(d.subtitle_list)
    };
}

// ----- dramawave -----
// Base: /dramawave/api/v1
// home: feed/<tab> -> data.items[].items[] (sectioned). The `<tab>` segment
//       is a tab name like `popular`, `new`, `recommend`. We default to
//       `popular`. (Note: a literal `feed/tab` path returns 404 upstream.)
// search: data.data.items[]
// detail: dramas/:id -> data.info { id, name, cover, episode_count, episode_list[] }
// play: dramas/:id/play/:ep -> data { ...episode... }
export const dramawave = {
    name: 'DramaWave',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('dramawave', 'feed/popular', { page: 1, lang });
        const sections = data?.data?.items || [];
        const items = [];
        for (const sec of sections) {
            // Some sections wrap items in `.items[]`; others are flat entries.
            if (Array.isArray(sec.items)) {
                for (const it of sec.items) items.push(it);
            } else {
                items.push(sec);
            }
        }
        return { dramas: filterValid(items.map(dwItem)) };
    },
    async categories() {
        return { categories: [] };
    },
    async categoryContent(ctx) {
        return dramawave.home(ctx);
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('dramawave', 'search', { q, keyword: q, lang });
        // Two response shapes observed: `data.items` or `data.data.items`.
        const items = data?.data?.data?.items || data?.data?.items || [];
        return { dramas: filterValid(items.map(dwItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('dramawave', `dramas/${id}`, { lang });
        const info = data?.data?.info || data?.data || {};
        return {
            id: String(info.id || id),
            title: info.name || info.title || '',
            poster: info.cover || '',
            intro: info.desc || 'Deskripsi tidak tersedia.',
            totalEpisodes: info.episode_count || (info.episode_list || []).length || 0,
            tags: info.content_tags || []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const data = await fetchApi('dramawave', `dramas/${dramaId}/play/${episodeId}`, { lang });
        const d = data?.data || data || {};
        return dwStreamFromEpisode(d);
    }
};

// ----- freereels -----
// Base: /freereels/api/v1
// foryou: { items:[ {key, title, cover, episode_count, container.episode_info, ...}, ...] }
// popular: sectioned `items[].items[]`
// detail: dramas/:id -> { episode_list:[{...}], ... }
// play: dramas/:id/play/:ep -> { ... episode ... } (same shape as dramawave's play)
export const freereels = {
    name: 'FreeReels',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('freereels', 'foryou', { lang });
        const items = data?.items || data?.data?.items || [];
        // Some sectioned items have nested .items[]; flatten.
        const flat = [];
        for (const it of items) {
            if (Array.isArray(it.items)) flat.push(...it.items);
            else flat.push(it);
        }
        return { dramas: filterValid(flat.map(dwItem)) };
    },
    async categories() {
        return {
            categories: [
                { id: 'popular', name: 'Populer' },
                { id: 'new', name: 'Terbaru' },
                { id: 'female', name: 'Wanita' },
                { id: 'male', name: 'Pria' },
                { id: 'anime', name: 'Anime' },
                { id: 'dubbing', name: 'Dubbing' }
            ]
        };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const allowed = ['popular', 'new', 'female', 'male', 'anime', 'dubbing'];
        const path = allowed.includes(id) ? id : 'popular';
        const data = await fetchApi('freereels', path, { lang });
        const items = data?.items || data?.data?.items || [];
        const flat = [];
        for (const it of items) {
            if (Array.isArray(it.items)) flat.push(...it.items);
            else flat.push(it);
        }
        return { dramas: filterValid(flat.map(dwItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('freereels', 'search', { q, lang });
        const items = data?.items || data?.data?.items || [];
        return { dramas: filterValid(items.map(dwItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('freereels', `dramas/${id}`, { lang });
        const d = data?.data || data || {};
        return {
            id: String(d.id || d.key || id),
            title: d.name || d.title || '',
            poster: d.cover || '',
            intro: d.desc || 'Deskripsi tidak tersedia.',
            totalEpisodes: d.episode_count || (d.episode_list || []).length || 0,
            tags: d.content_tags || []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const data = await fetchApi('freereels', `dramas/${dramaId}/play/${episodeId}`, { lang });
        const d = data?.data || data || {};
        return dwStreamFromEpisode(d);
    }
};
