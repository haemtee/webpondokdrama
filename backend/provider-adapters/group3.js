// Group 3: flickreels, stardusttv (existing supported providers)

import { normalizeSubtitle, filterValid } from './_helpers.js';

function frItem(d) {
    return {
        id: String(d.playlet_id || d.id || ''),
        title: d.playlet_title || d.title || '',
        poster: d.cover || d.cover_square || d.process_cover || '',
        episode_count: d.chapter_num || d.upload_num || d.episode || '?'
    };
}

// ----- flickreels -----
export const flickreels = {
    name: 'Flickreels',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('flickreels', 'for-you', { page: 1, page_size: 20, lang });
        const list = data?.data?.list || [];
        return { dramas: filterValid(list.map(frItem)) };
    },
    async categories({ fetchApi, lang }) {
        // The upstream nav contains a synthetic "home" entry whose backing
        // for-you call returns no dramas through our normalised flow, plus
        // the standard real categories. Drop it here so the frontend pill
        // row only shows useful tabs.
        const data = await fetchApi('flickreels', 'navigation', { lang });
        const list = data?.data || [];
        return {
            categories: list
                .filter(c => {
                    const n = (c.name || c.nav_name || c.display_name || '').toLowerCase();
                    return n && n !== 'home' && n !== 'beranda' && n !== 'for you';
                })
                .map(c => ({
                    id: String(c.id || c.nav_id || ''),
                    name: c.name || c.nav_name || c.display_name || ''
                }))
        };
    },
    async categoryContent({ fetchApi, lang }, { id, name }) {
        const cn = (name || '').toLowerCase();
        let path = 'category';
        const params = { lang, page: 1, page_size: 30 };
        if (cn === 'home' || cn.includes('for you') || cn.includes('beranda')) {
            path = 'for-you';
        } else if (cn.includes('rank') || cn.includes('peringkat')) {
            path = 'hot-rank';
        } else {
            params.navigation_id = id;
        }
        const data = await fetchApi('flickreels', path, params);
        let items = [];
        if (path === 'for-you') items = data?.data?.list || [];
        else if (path === 'hot-rank') {
            const groups = Array.isArray(data?.data) ? data.data : [];
            items = groups.flatMap(g => Array.isArray(g.data) ? g.data : []);
        } else {
            const groups = Array.isArray(data?.data) ? data.data : [];
            items = groups.flatMap(g => Array.isArray(g.list) ? g.list : []);
        }
        const seen = new Set();
        const dramas = [];
        for (const d of items) {
            const norm = frItem(d);
            if (!norm.id || seen.has(norm.id)) continue;
            seen.add(norm.id);
            dramas.push(norm);
        }
        return { dramas };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('flickreels', 'search', { keyword: q, lang });
        const list = Array.isArray(data?.data) ? data.data : (data?.data?.list || []);
        return { dramas: filterValid(list.map(frItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('flickreels', `chapters/${id}`, { lang });
        const info = data?.data || {};
        return {
            id: String(info.playlet_id || id),
            title: info.title || '',
            poster: info.cover || '',
            intro: info.desc || 'Deskripsi tidak tersedia.',
            totalEpisodes: info.list?.length || 0,
            tags: []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const chapterData = await fetchApi('flickreels', `chapters/${dramaId}`, { lang });
        const chapters = chapterData?.data?.list || [];
        const chapter = chapters[parseInt(episodeId) - 1];
        if (!chapter?.chapter_id) {
            return { source: '', qualities: {}, subtitles: [] };
        }
        const streamData = await fetchApi('flickreels', `stream/${dramaId}/${chapter.chapter_id}`, { lang });
        const d = streamData?.data || {};
        return {
            source: d.hls_url || d.down_url || '',
            qualities: {},
            subtitles: []
        };
    }
};

// ----- stardusttv -----
function sdItem(d) {
    return {
        id: String(d.id || d.video_id || ''),
        title: d.title || d.name || '',
        poster: d.poster || d.cover || '',
        episode_count: d.episode || d.episodes || d.totalEpisodes || '?'
    };
}

export const stardusttv = {
    name: 'StardustTV',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('stardusttv', 'homepage', { lang });
        const list = data?.data || [];
        return { dramas: filterValid(list.map(sdItem)) };
    },
    async categories({ fetchApi, lang }) {
        const data = await fetchApi('stardusttv', 'categories', { lang });
        const list = data?.data || [];
        return {
            categories: list.map(c => ({
                id: String(c.id || c.category_id || ''),
                name: c.name || c.title || ''
            }))
        };
    },
    async categoryContent({ fetchApi, lang }, { id, name }) {
        let list = [];
        try {
            const data = await fetchApi('stardusttv', `category/${id}`, { lang });
            list = data?.data?.data || data?.data || [];
        } catch (_) { /* fallback */ }
        if (!list.length && name) {
            const fallback = await fetchApi('stardusttv', 'search', { q: name, lang, page: 1, page_size: 20 });
            list = fallback?.data?.data || fallback?.data || [];
        }
        return { dramas: filterValid(list.map(sdItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('stardusttv', 'search', { q, lang, page: 1, page_size: 30 });
        const list = data?.data?.data || data?.data || [];
        return { dramas: filterValid(list.map(sdItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('stardusttv', `video/${id}`, { lang });
        const info = data?.data || {};
        return {
            id: String(info.id || id),
            title: info.title || '',
            poster: info.poster || '',
            intro: info.intro || 'Deskripsi tidak tersedia.',
            totalEpisodes: info.totalEpisodes || info.episodes?.length || 0,
            tags: []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const data = await fetchApi('stardusttv', `video/${dramaId}/episode/${episodeId}`, { lang });
        const d = data?.data || {};
        const qualities = {};
        if (d.h264) qualities['default'] = d.h264;
        if (d.h265) qualities['h265'] = d.h265;
        return {
            source: d.h264 || d.video_url || d.h265 || '',
            qualities,
            subtitles: []
        };
    }
};
