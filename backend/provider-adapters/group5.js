// Group 5: melolo, moboreels, netshort, pinedrama, reelife

import { normalizeSubtitle, filterValid } from './_helpers.js';

// ----- melolo -----
// melolo uses TikTok-like shapes. multi_video / video for play; book/series for detail; bookmall for home.
function mlItem(d) {
    return {
        id: String(d.book_id || d.series_id || d.id || ''),
        title: d.title || d.book_name || d.series_name || '',
        poster: d.cover || d.thumb_url || d.image || '',
        episode_count: d.episode_count || d.serial_count || '?'
    };
}
export const melolo = {
    name: 'Melolo',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('melolo', 'bookmall', { lang });
        const list = data?.cards?.flatMap(c => c.books || []) || data?.books || data?.data || [];
        return { dramas: filterValid(list.map(mlItem)) };
    },
    async categories({ fetchApi, lang }) {
        const data = await fetchApi('melolo', 'categories', { lang });
        const list = data?.categories || [];
        return { categories: list.map(c => ({ id: String(c.id), name: c.name })) };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const data = await fetchApi('melolo', 'bookmall', { categoryId: id, lang });
        const list = data?.cards?.flatMap(c => c.books || []) || data?.books || [];
        return { dramas: filterValid(list.map(mlItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('melolo', 'search', { q, keyword: q, lang });
        const list = data?.list || data?.books || [];
        return { dramas: filterValid(list.map(mlItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('melolo', 'series', { series_id: id, book_id: id, lang });
        const s = data?.series || data?.book_info || data || {};
        return {
            id: String(s.series_id || s.book_id || id),
            title: s.title || s.book_name || '',
            poster: s.cover || s.thumb_url || '',
            intro: s.intro || s.abstract || 'Deskripsi tidak tersedia.',
            totalEpisodes: s.episode_count || data?.episodes?.length || 0,
            tags: s.categories || []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const data = await fetchApi('melolo', 'video', { vid: episodeId, video_id: episodeId, lang });
        const d = data?.parsed || data || {};
        const qualities = {};
        let source = data?.main_url || '';
        const videos = d.videos || {};
        for (const [, v] of Object.entries(videos)) {
            if (!v.main_url) continue;
            qualities[v.definition || v.quality] = v.main_url;
            if (!source) source = v.main_url;
        }
        return { source, qualities, subtitles: [] };
    }
};

// ----- moboreels -----
function mbItem(d) {
    return {
        id: String(d.seriesId || d.id || ''),
        title: d.seriesName || d.title || '',
        poster: d.coverUrl || d.cover || '',
        episode_count: d.totalEpisodes || '?'
    };
}
export const moboreels = {
    name: 'MoboReels',
    async home({ fetchApi, lang }) {
        const langId = lang === 'id' ? 11 : 1;
        const ch = await fetchApi('moboreels', 'channelList', { langId });
        const channels = ch?.data?.channels || [];
        const def = channels.find(c => c.isDefault) || channels[0];
        if (!def) return { dramas: [] };
        const data = await fetchApi('moboreels', 'channelDetail', { channelId: def.channelId, langId });
        const sections = data?.data?.sections || [];
        const items = sections.flatMap(s => s.series || []);
        return { dramas: filterValid(items.map(mbItem)) };
    },
    async categories({ fetchApi, lang }) {
        const langId = lang === 'id' ? 11 : 1;
        const data = await fetchApi('moboreels', 'channelList', { langId });
        const list = data?.data?.channels || [];
        return { categories: list.map(c => ({ id: String(c.channelId), name: c.title })) };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const langId = lang === 'id' ? 11 : 1;
        const data = await fetchApi('moboreels', 'channelDetail', { channelId: id, langId });
        const sections = data?.data?.sections || [];
        const items = sections.flatMap(s => s.series || []);
        return { dramas: filterValid(items.map(mbItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const langId = lang === 'id' ? 11 : 1;
        const data = await fetchApi('moboreels', 'search', { q, keyword: q, langId });
        const list = data?.data?.series || data?.data || [];
        return { dramas: filterValid(list.map(mbItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const langId = lang === 'id' ? 11 : 1;
        const data = await fetchApi('moboreels', 'seriesDetail', { seriesId: id, langId });
        const d = data?.data || {};
        return {
            id: String(d.seriesId || id),
            title: d.seriesName || '',
            poster: d.coverUrl || '',
            intro: d.description || 'Deskripsi tidak tersedia.',
            totalEpisodes: d.totalEpisodes || 0,
            tags: d.genres || []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const langId = lang === 'id' ? 11 : 1;
        const data = await fetchApi('moboreels', 'video', { seriesId: dramaId, episNum: episodeId, langId });
        const d = data || {};
        const qualities = {};
        for (const m of d.episMedia || []) {
            const key = `${m.resolution}p`;
            qualities[key] = m.mediaUrl;
        }
        return {
            source: d.mediaUrl || qualities['1080p'] || qualities['720p'] || '',
            qualities,
            subtitles: []
        };
    }
};

// ----- netshort -----
function nsItem(d) {
    return {
        id: String(d.id || d.dramaId || ''),
        title: d.title || d.name || '',
        poster: d.cover || d.coverUrl || '',
        episode_count: d.totalEpisodes || d.episodes || '?'
    };
}
export const netshort = {
    name: 'NetShort',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('netshort', 'feed/page', { lang, page: 1 });
        const list = data?.data?.list || data?.data?.dramas || data?.data || [];
        return { dramas: filterValid(list.map(nsItem)) };
    },
    async categories({ fetchApi, lang }) {
        const data = await fetchApi('netshort', 'tabs', { lang });
        const list = data?.data?.tabs || data?.data || [];
        return { categories: list.map(t => ({ id: String(t.id || t.tabId), name: t.name || t.title })) };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const data = await fetchApi('netshort', `tab/${id}/page`, { lang, page: 1 });
        const list = data?.data?.list || data?.data || [];
        return { dramas: filterValid(list.map(nsItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('netshort', 'search', { q, keyword: q, lang, page: 1 });
        const list = data?.data?.list || data?.data || [];
        return { dramas: filterValid(list.map(nsItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('netshort', `detail/${id}`, { lang });
        const d = data?.data || {};
        return {
            id: String(d.id || id),
            title: d.title || d.name || '',
            poster: d.cover || '',
            intro: d.description || d.intro || 'Deskripsi tidak tersedia.',
            totalEpisodes: d.totalEpisodes || 0,
            tags: d.tags || []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const data = await fetchApi('netshort', `episode/${dramaId}/${episodeId}`, { lang });
        const d = data?.data || {};
        const qualities = {};
        for (const v of d.videos || []) {
            qualities[v.quality] = v.url;
        }
        const subs = (d.subtitles || []).map(s => normalizeSubtitle({
            language: s.language || s.lang,
            label: s.name || s.lang,
            url: s.url
        })).filter(Boolean);
        return {
            source: qualities['1080p'] || qualities['720p'] || qualities['540p'] || qualities['480p'] || (d.videos?.[0]?.url || ''),
            qualities,
            subtitles: subs
        };
    }
};

// ----- pinedrama -----
function pdItem(d) {
    return {
        id: String(d.collectionId || d.id || ''),
        title: d.title || '',
        poster: d.cover || '',
        episode_count: d.totalEpisodes || '?'
    };
}
export const pinedrama = {
    name: 'PineDrama',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('pinedrama', 'drama/center', { scene: 1, category_id: 0, count: 30, language: lang, region: 'ID' });
        const list = data?.data?.collections || [];
        return { dramas: filterValid(list.map(pdItem)) };
    },
    async categories({ fetchApi, lang }) {
        const data = await fetchApi('pinedrama', 'drama/categories', { language: lang, region: 'ID' });
        const list = data?.data || [];
        return { categories: list.map(c => ({ id: String(c.categoryId), name: c.name })) };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const data = await fetchApi('pinedrama', 'drama/center', { scene: 1, category_id: id, count: 30, language: lang, region: 'ID' });
        const list = data?.data?.collections || [];
        return { dramas: filterValid(list.map(pdItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('pinedrama', 'drama/search', { keyword: q, language: lang, region: 'ID' });
        const list = Array.isArray(data?.data) ? data.data : (data?.data?.collections || []);
        return { dramas: filterValid(list.map(pdItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('pinedrama', 'drama/detail', { collection_id: id, language: lang, region: 'ID' });
        const d = data?.data || {};
        return {
            id: String(d.collectionId || id),
            title: d.title || '',
            poster: d.cover || '',
            intro: d.synopsis || d.description || 'Deskripsi tidak tersedia.',
            totalEpisodes: d.totalEpisodes || 0,
            tags: (d.categories || '').split(',').filter(Boolean)
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const data = await fetchApi('pinedrama', 'drama/play', { collection_id: dramaId, episode: episodeId, language: lang, region: 'ID' });
        const d = data?.data || {};
        const subs = (d.subtitles || []).map(s => normalizeSubtitle({
            language: s.lang,
            label: s.lang,
            url: s.url,
            format: (s.format === 'webvtt') ? 'vtt' : 'srt'
        })).filter(Boolean);
        return { source: d.playUrl || '', qualities: {}, subtitles: subs };
    }
};

// ----- reelife -----
function rlItem(d) {
    return {
        id: String(d.bookId || d.id || ''),
        title: d.bookName || d.title || '',
        poster: d.coverWap || d.cover || '',
        episode_count: d.lastChapterId || d.chapterCount || '?'
    };
}
export const reelife = {
    name: 'ReeLife',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('reelife', 'foryou', { lang });
        const list = data?.data?.list || data?.data?.records || data?.data || [];
        return { dramas: filterValid(list.map(rlItem)) };
    },
    async categories() {
        return {
            categories: [
                { id: 'foryou', name: 'For You' },
                { id: 'ranking', name: 'Peringkat' },
                { id: 'dramas', name: 'Semua' }
            ]
        };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const path = ['foryou', 'ranking', 'dramas'].includes(id) ? id : 'foryou';
        const data = await fetchApi('reelife', path, { lang });
        const list = data?.data?.list || data?.data?.records || data?.data || [];
        return { dramas: filterValid(list.map(rlItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('reelife', 'search', { q, lang });
        const list = data?.data?.list || data?.data || [];
        return { dramas: filterValid(list.map(rlItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('reelife', `dramas/${id}`, { lang });
        const d = data?.data?.bookVo || data?.data || {};
        return {
            id: String(d.bookId || id),
            title: d.bookName || '',
            poster: d.coverWap || '',
            intro: d.introduction || 'Deskripsi tidak tersedia.',
            totalEpisodes: parseInt(d.lastChapterId) || 0,
            tags: []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const data = await fetchApi('reelife', `dramas/${dramaId}/episodes/${episodeId}`, { lang });
        const d = data?.data || {};
        const chapter = (d.chapterContentList || [])[0] || {};
        const qualities = {};
        for (const v of chapter.videoInfoList || []) {
            qualities[`${v.quality}p`] = v.videoPath;
        }
        return {
            source: data?.video_url || chapter.mp4720p || qualities['720p'] || qualities['540p'] || '',
            qualities,
            subtitles: []
        };
    }
};
