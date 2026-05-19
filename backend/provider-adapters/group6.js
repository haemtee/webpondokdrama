// Group 6: reelshort, snackshort, starshort, velolo

import { normalizeSubtitle, filterValid } from './_helpers.js';

// ----- reelshort -----
function rsItem(d) {
    return {
        id: String(d.book_id || d.id || ''),
        title: d.book_title || d.title || '',
        poster: d.book_pic || d.cover || '',
        episode_count: d.chapter_count || d.totalChapter || '?'
    };
}
export const reelshort = {
    name: 'ReelShort',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('reelshort', 'foryou', { lang });
        const lists = data?.data?.lists || [];
        const items = lists.flatMap(l => l.books || []);
        return { dramas: filterValid(items.map(rsItem)) };
    },
    async categories({ fetchApi, lang }) {
        const data = await fetchApi('reelshort', 'foryou', { lang });
        const tabs = data?.data?.tab_list || [];
        return { categories: tabs.map(t => ({ id: String(t.tab_id), name: t.tab_name })) };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const data = await fetchApi('reelshort', `feed/${id}`, { lang });
        const lists = data?.data?.lists || [];
        const items = lists.flatMap(l => l.books || []);
        return { dramas: filterValid(items.map(rsItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('reelshort', 'search', { q, keyword: q, lang, page: 1 });
        const list = data?.data?.list || data?.data?.books || [];
        return { dramas: filterValid(list.map(rsItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('reelshort', `book/${id}`, { lang });
        const d = data?.data || {};
        return {
            id: String(d.book_id || id),
            title: d.book_title || '',
            poster: d.book_pic || '',
            intro: d.introduction || d.description || 'Deskripsi tidak tersedia.',
            totalEpisodes: d.chapter_count || 0,
            tags: d.tags || []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const chapters = await fetchApi('reelshort', `book/${dramaId}/chapters`, { lang }).catch(() => null);
        const list = chapters?.data?.chapters || chapters?.data || [];
        const ch = list.find(c => String(c.chapter_order || c.chapter_index) === String(episodeId)) || list[parseInt(episodeId) - 1];
        const chapterId = ch?.chapter_id || episodeId;
        const data = await fetchApi('reelshort', `book/${dramaId}/chapter/${chapterId}/video`, { lang });
        const d = data?.data || {};
        const qualities = {};
        let source = '';
        for (const v of d.videos || []) {
            const key = `${v.Dpi || v.dpi || 0}p`;
            qualities[key] = v.PlayURL;
            if (!source && v.PlayURL) source = v.PlayURL;
        }
        return { source, qualities, subtitles: [] };
    }
};

// ----- snackshort -----
function snItem(d) {
    return {
        id: String(d.book_id || d.id || ''),
        title: d.title || d.book_name || '',
        poster: d.cover_key || d.image || d.bannerImage || '',
        episode_count: d.chapters || d.onlineChapter || '?'
    };
}
export const snackshort = {
    name: 'SnackShort',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('snackshort', 'home', { lang });
        const sections = data?.data?.data || [];
        const items = sections.flatMap(s => s.book_data || []);
        return { dramas: filterValid(items.map(snItem)) };
    },
    async categories({ fetchApi, lang }) {
        const data = await fetchApi('snackshort', 'tabs', { lang });
        const list = data?.data?.data?.tabs || data?.data?.tabs || [];
        return { categories: list.map(t => ({ id: String(t.id), name: t.name })) };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const data = await fetchApi('snackshort', 'browsing', { tabId: id, lang });
        const sections = data?.data?.data || data?.data || [];
        const items = Array.isArray(sections)
            ? sections.flatMap(s => s.book_data || s.books || [])
            : (sections.list || sections.books || []);
        return { dramas: filterValid(items.map(snItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('snackshort', 'search', { q, lang });
        const list = data?.data?.data?.data || data?.data?.data || [];
        return { dramas: filterValid(list.map(snItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('snackshort', `book/${id}`, { lang });
        const book = data?.data?.data?.book || {};
        return {
            id: String(book.book_id || id),
            title: book.book_name || '',
            poster: book.image || '',
            intro: book.introduce || 'Deskripsi tidak tersedia.',
            totalEpisodes: book.chapters || 0,
            tags: book.tag || []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const chapters = await fetchApi('snackshort', `book/${dramaId}/chapters`, { lang }).catch(() => null);
        const list = chapters?.data?.data || [];
        const ch = list.find(c => String(c.chapter_order) === String(episodeId)) || list[parseInt(episodeId) - 1];
        const chapterId = ch?.chapter_id || episodeId;
        const data = await fetchApi('snackshort', `book/${dramaId}/episode/${chapterId}`, { lang });
        const d = data?.data?.data?.data || data?.data?.data || {};
        return { source: d.playUrl || '', qualities: {}, subtitles: [] };
    }
};

// ----- starshort -----
function stItem(d) {
    return {
        id: String(d.id || d.drama_id || ''),
        title: d.title || '',
        poster: d.cover || '',
        episode_count: d.total_episodes || '?'
    };
}
function starLangId(lang) {
    if (lang === 'id') return 4;
    if (lang === 'en') return 3;
    return lang;
}
export const starshort = {
    name: 'StarShort',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('starshort', 'dramas', { lang: starLangId(lang) });
        const list = Array.isArray(data) ? data : (data?.data || []);
        return { dramas: filterValid(list.map(stItem)) };
    },
    async categories() {
        return {
            categories: [
                { id: 'dramas', name: 'Populer' },
                { id: 'dramas/new', name: 'Terbaru' }
            ]
        };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const path = id === 'dramas/new' ? 'dramas/new' : 'dramas';
        const data = await fetchApi('starshort', path, { lang: starLangId(lang) });
        const list = Array.isArray(data) ? data : (data?.data || []);
        return { dramas: filterValid(list.map(stItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('starshort', 'dramas/search', { q, lang: starLangId(lang) });
        const list = Array.isArray(data) ? data : (data?.data || []);
        return { dramas: filterValid(list.map(stItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('starshort', `dramas/${id}`, { lang: starLangId(lang) });
        const d = data || {};
        return {
            id: String(d.id || id),
            title: d.title || '',
            poster: d.cover || '',
            intro: d.description || 'Deskripsi tidak tersedia.',
            totalEpisodes: d.total_episodes || 0,
            tags: d.tags || []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const data = await fetchApi('starshort', `dramas/${dramaId}/episodes/${episodeId}`, { lang: starLangId(lang) });
        const d = data || {};
        return { source: d.video_url || '', qualities: {}, subtitles: [] };
    }
};

// ----- velolo -----
// /velolo
//   hot, new, labels, dramas?keyword|labelId, suggest
//   detail/:id -> { videoInfo:{...}, episodesInfo:{ rows:[{ orderNumber, videoAddress, zimu }] } }
//   stream?url=<m3u8> -> { m3u8 } (just echoes the URL; not useful as primary path)
// The detail endpoint already gives us the full m3u8 list keyed by orderNumber
// (zero-based). We use that directly instead of the lossy stream endpoint.
function veItem(d) {
    return {
        id: String(d.id || ''),
        title: d.name || '',
        poster: d.cover || '',
        episode_count: d.episode || '?'
    };
}
export const velolo = {
    name: 'Velolo',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('velolo', 'hot', { lang });
        const list = data?.rows || data?.data || [];
        return { dramas: filterValid(list.map(veItem)) };
    },
    async categories({ fetchApi, lang }) {
        const data = await fetchApi('velolo', 'labels', { lang });
        const list = Array.isArray(data) ? data : (data?.data || []);
        return { categories: list.map(c => ({ id: String(c.id), name: c.label })) };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const data = await fetchApi('velolo', 'dramas', { labelId: id, lang });
        const list = data?.rows || data?.data || [];
        return { dramas: filterValid(list.map(veItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('velolo', 'dramas', { keyword: q, lang });
        const list = data?.rows || data?.data || [];
        return { dramas: filterValid(list.map(veItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('velolo', `detail/${id}`, { lang });
        const info = data?.videoInfo || data?.data || data || {};
        return {
            id: String(info.id || id),
            title: info.name || '',
            poster: info.cover || '',
            intro: info.introduction || 'Deskripsi tidak tersedia.',
            totalEpisodes: info.episode || 0,
            tags: info.label || []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const data = await fetchApi('velolo', `detail/${dramaId}`, { lang });
        const rows = data?.episodesInfo?.rows || [];
        const epIndex = parseInt(episodeId, 10) - 1;
        const ep = rows.find(r => r.orderNumber === epIndex)
            || rows[epIndex]
            || rows.find(r => String(r.id) === String(episodeId));
        const url = ep?.videoAddress || '';
        const subtitles = [];
        if (ep?.zimu) {
            subtitles.push({
                language: 'id',
                label: 'Indonesia',
                url: ep.zimu,
                format: ep.zimu.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt'
            });
        }
        return { source: url, qualities: {}, subtitles };
    }
};
