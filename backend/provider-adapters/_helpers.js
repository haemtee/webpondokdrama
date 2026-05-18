// Shared helpers for provider adapters.

// Normalize a subtitle list from a provider into the canonical shape used by
// the frontend video player.
//
// canonical = [{ language, label, url, format }]
//
// `format` is "srt" or "vtt" (the player supports both via SRT->VTT proxy).
export function normalizeSubtitle({ language, label, url, format }) {
    if (!url) return null;
    const lang = (language || '').toLowerCase();
    return {
        language: lang || 'unknown',
        label: label || lang || 'Unknown',
        url,
        format: format || (url.endsWith('.vtt') ? 'vtt' : 'srt')
    };
}

// Map a list, drop nulls.
export function compact(arr, mapFn) {
    const out = [];
    for (const item of arr || []) {
        const v = mapFn ? mapFn(item) : item;
        if (v) out.push(v);
    }
    return out;
}

// Convert any provider's `cover` field into a stable poster URL.
export function pickPoster(d) {
    return d?.cover || d?.poster || d?.image || d?.thumbnail || d?.coverUrl || d?.cover_key || d?.coverWap || d?.bookCover || d?.book_pic || '';
}

// Best-effort drama id picker.
export function pickId(d) {
    return d?.id ?? d?.drama_id ?? d?.dramaId ?? d?.book_id ?? d?.bookId ?? d?.series_id ?? d?.seriesId ?? d?.collectionId ?? d?.contentId ?? d?.videoid ?? d?.playlet_id ?? d?.key ?? d?.programId ?? '';
}

// Best-effort title picker.
export function pickTitle(d) {
    return d?.title || d?.name || d?.book_name || d?.bookName || d?.series_name || d?.seriesName || d?.contentName || d?.videoName || d?.playlet_title || d?.book_title || '';
}

// Best-effort episode count picker.
export function pickEpisodeCount(d) {
    return d?.episodes || d?.episode || d?.totalEpisodes || d?.total_episodes || d?.episode_count || d?.episodeCount || d?.chapters || d?.chapter_num || d?.upload_num || d?.last_series_no || d?.totalEpisodeNum || d?.chapterNumber || d?.totalEpisode || '?';
}

// Generic shallow normalize: returns {id, title, poster, episode_count}
export function normalizeItem(d) {
    return {
        id: String(pickId(d) || ''),
        title: pickTitle(d),
        poster: pickPoster(d),
        episode_count: pickEpisodeCount(d)
    };
}

// Filter out items that don't have at least an id and a title.
export function filterValid(items) {
    return (items || []).filter(x => x && x.id && x.title);
}

// Try multiple paths and return the first that returns successfully.
// `attempts` is [{path, params}].
export async function tryEndpoints(fetchApi, provider, attempts) {
    let lastErr = null;
    for (const a of attempts) {
        try {
            return await fetchApi(provider, a.path, a.params || {});
        } catch (e) {
            lastErr = e;
        }
    }
    if (lastErr) throw lastErr;
    return null;
}
