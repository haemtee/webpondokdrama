// Group 4: cubetv, flextv, vigloo, sereal, sarostv

import { normalizeSubtitle, filterValid } from './_helpers.js';

// ----- cubetv -----
// /cubetv/...   list shape uses videoid, videoName, cover, totalEpisodeNum
// /cubetv/stream/:videoid/:episodeid -> { linkInfo:[{linkUrl, codeRate}], videoCaption:[{language_code, url}] }
function ctItem(d) {
    return {
        id: String(d.videoid || d.id || ''),
        title: d.videoName || d.title || '',
        poster: d.cover || '',
        episode_count: d.totalEpisodeNum || d.totalEpisode || '?'
    };
}
export const cubetv = {
    name: 'CubeTV',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('cubetv', 'home/recommendations', { lang });
        const modules = data?.data?.moduleVideo || [];
        const items = modules.flatMap(m => m.videoList || []);
        return { dramas: filterValid(items.map(ctItem)) };
    },
    async categories() {
        return {
            categories: [
                { id: 'home/trending', name: 'Trending' },
                { id: 'home/romance', name: 'Roman' },
                { id: 'home/shows', name: 'Acara' },
                { id: 'coming_soon', name: 'Akan Datang' }
            ]
        };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const path = id || 'home/trending';
        const data = await fetchApi('cubetv', path, { lang });
        const list = data?.data?.list || data?.data?.moduleVideo?.flatMap(m => m.videoList || []) || [];
        return { dramas: filterValid(list.map(ctItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('cubetv', 'search', { q, lang });
        const list = data?.data?.list || [];
        return { dramas: filterValid(list.map(ctItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('cubetv', `shows/${id}`, { lang }).catch(() => null);
        const info = data?.data || {};
        return {
            id: String(info.videoid || id),
            title: info.videoName || info.title || '',
            poster: info.cover || '',
            intro: info.summary || 'Deskripsi tidak tersedia.',
            totalEpisodes: info.totalEpisodeNum || 0,
            tags: info.tagInfo || []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const epData = await fetchApi('cubetv', `episode/${dramaId}/list`, { lang }).catch(() => null);
        const eps = epData?.data || [];
        const ep = eps.find(e => String(e.episodeNumber) === String(episodeId)) || eps[parseInt(episodeId) - 1];
        const epid = ep?.episodeid || episodeId;
        const data = await fetchApi('cubetv', `stream/${dramaId}/${epid}`, { lang });
        const d = data?.data || {};
        const links = d.linkInfo || [];
        const qualities = {};
        let source = '';
        for (const l of links) {
            const key = (l.codeRate || 'sd').toLowerCase();
            qualities[key] = l.linkUrl;
            if (!source) source = l.linkUrl;
        }
        const subs = (d.videoCaption || []).map(s => normalizeSubtitle({
            language: s.language_code,
            label: s.language_code,
            url: s.url
        })).filter(Boolean);
        return { source, qualities, subtitles: subs };
    }
};

// ----- flextv -----
// /flextv/api/v1, response wrapper { code, data }
// search: data.list[]; series: data { series_name, cover, last_series_no }
// play: data.play_info[].play_url
function ftItem(d) {
    return {
        id: String(d.series_id || d.id || ''),
        title: d.series_name || d.recommend_name || '',
        poster: d.cover || d.image || '',
        episode_count: d.last_series_no || '?'
    };
}
export const flextv = {
    name: 'FlexTV',
    async home({ fetchApi, lang }) {
        const tabsData = await fetchApi('flextv', 'tabs', { lang });
        const tabs = tabsData?.data?.classify_info || [];
        const firstId = tabs[0]?.classify_id;
        if (!firstId) {
            const banners = tabsData?.data?.banner_list || [];
            return { dramas: filterValid(banners.map(ftItem)) };
        }
        const data = await fetchApi('flextv', `tabs/${firstId}`, { lang });
        const floors = data?.data?.floor || [];
        const items = floors.flatMap(f => f.series_list || []);
        return { dramas: filterValid(items.map(ftItem)) };
    },
    async categories({ fetchApi, lang }) {
        const data = await fetchApi('flextv', 'tabs', { lang });
        const list = data?.data?.classify_info || [];
        return {
            categories: list.map(c => ({
                id: String(c.classify_id),
                name: c.classify_name
            }))
        };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const data = await fetchApi('flextv', `tabs/${id}`, { lang });
        const floors = data?.data?.floor || [];
        const items = floors.flatMap(f => f.series_list || []);
        return { dramas: filterValid(items.map(ftItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('flextv', 'search', { q, keyword: q, lang });
        const list = data?.data?.list || [];
        return { dramas: filterValid(list.map(ftItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('flextv', `series/${id}`, { lang });
        const d = data?.data || {};
        return {
            id: String(d.series_id || id),
            title: d.series_name || '',
            poster: d.cover || '',
            intro: d.description || 'Deskripsi tidak tersedia.',
            totalEpisodes: d.last_series_no || (d.series_no_list || []).length || 0,
            tags: (d.tag_list || []).map(t => t.tag_name || t)
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const eps = await fetchApi('flextv', `series/${dramaId}/episodes`, { lang }).catch(() => null);
        const list = eps?.data?.list || eps?.data || [];
        const ep = list.find(e => String(e.series_no || e.episode || e.section_no) === String(episodeId)) || list[parseInt(episodeId) - 1];
        const sectionId = ep?.section_id || ep?.id || episodeId;
        const data = await fetchApi('flextv', `play/${dramaId}/${sectionId}`, { lang });
        const d = data?.data || {};
        const playInfo = d.play_info || [];
        const qualities = {};
        let source = d.play_url || '';
        for (const p of playInfo) {
            if (!p.play_url) continue;
            const key = (p.definition || p.quality || 'auto').toLowerCase();
            qualities[key] = p.play_url;
            if (!source) source = p.play_url;
        }
        return { source, qualities, subtitles: [] };
    }
};

// ----- vigloo -----
// /vigloo/api/v1
// home tabs: payloads -> ranking + recommend
// drama/:id      -> { drama:{ id, title, episodeCount, seasons:[{id,programId,...}], ... } }
// play?seasonId=&ep= -> { payload:{ url, cookies:{ CloudFront-Policy, CloudFront-Signature, CloudFront-Key-Pair-Id } } }
//   The URL is a CloudFront-signed master m3u8 that will 403 unless those
//   cookies are sent as HTTP Cookie headers. We piggy-back them through our
//   media proxy via the `__dr_cookies` query parameter (see proxy.js).
function vgItem(d) {
    return {
        id: String(d.id || d.programId || ''),
        title: d.title || '',
        poster: d.thumbnail || d.bannerImage || d.titleImage || '',
        episode_count: d.episodeCount || d.totalEpisode || '?'
    };
}
function vgEncodeCookies(cookies) {
    if (!cookies || typeof cookies !== 'object') return '';
    try {
        return Buffer.from(JSON.stringify(cookies)).toString('base64');
    } catch (_) {
        return '';
    }
}
export const vigloo = {
    name: 'Vigloo',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('vigloo', 'browse', { lang, page: 1, size: 30 });
        const items = data?.payloads || data?.data || [];
        return { dramas: filterValid(items.map(vgItem)) };
    },
    async categories({ fetchApi, lang }) {
        const data = await fetchApi('vigloo', 'tabs', { lang });
        const list = data?.payloads || [];
        return { categories: list.map(t => ({ id: String(t.id), name: t.title })) };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const data = await fetchApi('vigloo', `tabs/${id}`, { lang });
        const list = data?.payloads || [];
        return { dramas: filterValid(list.map(vgItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('vigloo', 'search', { q, lang });
        const list = data?.payloads || [];
        return { dramas: filterValid(list.map(vgItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('vigloo', `drama/${id}`, { lang });
        const d = data?.drama || data?.payload || data?.payloads?.[0] || {};
        return {
            id: String(d.id || id),
            title: d.title || '',
            poster: d.thumbnail || d.bannerImage || '',
            intro: d.logLine || d.description || 'Deskripsi tidak tersedia.',
            totalEpisodes: d.episodeCount || 0,
            tags: (d.genres || []).map(g => g.title)
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        // Vigloo's play endpoint is keyed on seasonId, not the program/drama
        // id we expose to the frontend. Resolve it via the drama detail.
        const detail = await fetchApi('vigloo', `drama/${dramaId}`, { lang });
        const seasons = detail?.drama?.seasons || [];
        const seasonId = seasons[0]?.id;
        if (!seasonId) return { source: '', qualities: {}, subtitles: [] };

        const data = await fetchApi('vigloo', 'play', { seasonId, ep: episodeId, lang });
        const payload = data?.payload || data?.data || {};
        let url = payload.url || '';
        if (url && payload.cookies) {
            const enc = vgEncodeCookies(payload.cookies);
            if (enc) {
                const sep = url.includes('?') ? '&' : '?';
                url = `${url}${sep}__dr_cookies=${enc}`;
            }
        }
        return { source: url, qualities: {}, subtitles: [] };
    }
};

// ----- sereal -----
// /sereal/api  paths use slashes, not underscores:
//   index/home/:page          -> { data:{ records:[{ records:[{contentId,...}] }], indexClassInfos:[...] } }
//   index/for-you/:page       -> same shape (more rows)
//   index/search/:q           -> { data:{ list:[...] } }
//   index/content-search/:id/:page -> { data:{ records:[...] } }
//   content/detail?contentId= -> detail page
//   watch/:contentId/:ep      -> { data:{ url } }
function srItem(d) {
    return {
        id: String(d.contentId || d.id || ''),
        title: d.contentName || d.title || '',
        poster: d.contentCoverUrl || d.url || '',
        episode_count: d.chapterNumber || d.chapterNum || '?'
    };
}
export const sereal = {
    name: 'Sereal',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('sereal', 'index/home/1', { lang });
        const records = data?.data?.records || [];
        const items = records.flatMap(r => r.records || []);
        return { dramas: filterValid(items.map(srItem)) };
    },
    async categories({ fetchApi, lang }) {
        const data = await fetchApi('sereal', 'index/home/1', { lang });
        const list = data?.data?.indexClassInfos || [];
        return { categories: list.map(c => ({ id: String(c.id), name: c.className })) };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const data = await fetchApi('sereal', `index/content-search/${id}/1`, { lang });
        const list = data?.data?.list || data?.data?.records || [];
        // content-search occasionally wraps items the same way `home` does.
        const flat = list.flatMap(r => r.records ? r.records : [r]);
        return { dramas: filterValid(flat.map(srItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('sereal', `index/search/${encodeURIComponent(q)}`, { lang });
        const list = data?.data?.list || data?.data?.records || [];
        return { dramas: filterValid(list.map(srItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('sereal', 'content/detail', { contentId: id, lang });
        const d = data?.data || {};
        return {
            id: String(d.contentId || d.id || id),
            title: d.contentName || '',
            poster: d.contentCoverUrl || '',
            intro: d.introduce || 'Deskripsi tidak tersedia.',
            totalEpisodes: d.chapterNum || d.chapterNumber || 0,
            tags: (d.tagList || []).map(t => t.name)
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const data = await fetchApi('sereal', `watch/${dramaId}/${episodeId}`, { lang });
        const d = data?.data || {};
        return { source: d.url || '', qualities: {}, subtitles: [] };
    }
};

// ----- sarostv -----
// /sarostv/api  series/:id, series/search?q=, series/episode?seriesId=&ep=
// theater: home; recommend: foryou
function ssItem(d) {
    return {
        id: String(d.id || d.seriesId || ''),
        title: d.name || d.title || '',
        poster: d.cover || d.poster || '',
        episode_count: d.episodes || d.totalEpisodes || '?'
    };
}
export const sarostv = {
    name: 'SarosTV',
    async home({ fetchApi, lang }) {
        const data = await fetchApi('sarostv', 'theater', { lang });
        const list = data?.data || data?.list || [];
        const items = Array.isArray(list) ? list : (list.modules?.flatMap(m => m.list || []) || []);
        return { dramas: filterValid(items.map(ssItem)) };
    },
    async categories({ fetchApi, lang }) {
        const data = await fetchApi('sarostv', 'types', { lang });
        const list = data?.data || [];
        return { categories: list.map(c => ({ id: String(c.id || c.typeId), name: c.name || c.typeName })) };
    },
    async categoryContent({ fetchApi, lang }, { id }) {
        const data = await fetchApi('sarostv', 'series', { typeId: id, lang });
        const list = data?.data?.list || data?.data || [];
        return { dramas: filterValid(list.map(ssItem)) };
    },
    async search({ fetchApi, lang }, q) {
        const data = await fetchApi('sarostv', 'series/search', { q, keyword: q, lang });
        const list = data?.data?.list || data?.data || [];
        return { dramas: filterValid(list.map(ssItem)) };
    },
    async detail({ fetchApi, lang }, id) {
        const data = await fetchApi('sarostv', 'series', { id, lang });
        const d = data?.data || {};
        return {
            id: String(d.id || id),
            title: d.name || '',
            poster: d.cover || '',
            intro: d.description || 'Deskripsi tidak tersedia.',
            totalEpisodes: d.episodes || (d.episodeList || []).length || 0,
            tags: d.tags || []
        };
    },
    async stream({ fetchApi, lang }, dramaId, episodeId) {
        const data = await fetchApi('sarostv', 'series/episode', { seriesId: dramaId, ep: episodeId, episode: episodeId, lang });
        const d = data?.data || {};
        return { source: d.url || '', qualities: {}, subtitles: [] };
    }
};
