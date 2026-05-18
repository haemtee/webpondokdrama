// Provider adapter registry.
// Every provider implements a subset of these methods that return data in a
// normalized shape consumable by the frontend:
//
//   home(ctx)         -> { dramas: [{id, title, poster, episode_count}] }
//   categories(ctx)   -> { categories: [{id, name}] }
//   categoryContent(ctx, {id, name}) -> { dramas: [...] }
//   search(ctx, q)    -> { dramas: [...] }
//   detail(ctx, id)   -> { id, title, poster, intro, totalEpisodes, tags }
//   stream(ctx, dramaId, episodeId, {res, lang}) -> { source, subtitles, qualities }
//
// `ctx` is { fetchApi, lang, cache } where fetchApi(provider, path, params)
// performs a cached upstream GET against the captain proxy.

import { adapters as _adapters } from './provider-adapters/index.js';

export const providerAdapters = _adapters;

export function getAdapter(provider) {
    return providerAdapters[provider] || null;
}

export const PROVIDER_LIST = Object.keys(providerAdapters);
