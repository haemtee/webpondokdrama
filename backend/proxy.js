import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { db } from './db.js';
import { cache } from './cache.js';
import { hashPassword, comparePassword, generateToken, authMiddleware, isAdmin, verifyToken } from './auth.js';
import { getAdapter, PROVIDER_LIST } from './providers.js';
import { fetchSubtitleAsVtt, isSrtUrl } from './subtitle.js';
import {
    recordEvent,
    clientIpFrom,
    getOverview,
    getDailySeries,
    getTopContent,
    getSubscriptionFunnel,
    getEventBreakdown,
    getProviderBreakdown
} from './analytics.js';
import { runBootstrap } from './bootstrap.js';

const app = new Hono();

// Connect to Redis on startup
cache.connect();

// Apply schema migrations and (optionally) promote ADMIN_EMAIL to admin role
// before serving any traffic. Errors are logged inside runBootstrap so a
// transient DB hiccup doesn't crash the server — the analytics endpoints
// will simply return errors until the schema is reachable.
runBootstrap().catch((e) => {
    console.error('[bootstrap] unexpected failure:', e.message);
});

// -------------- AUTH ROUTES --------------
app.post('/api/auth/register', async (c) => {
    try {
        const { email, password } = await c.req.json();
        const hashedPassword = await hashPassword(password);
        const [result] = await db.query(
            'INSERT INTO users (email, password_hash) VALUES (?, ?)',
            [email, hashedPassword]
        );
        // Record analytics asynchronously; do not await so we don't slow the
        // response. recordEvent is internally fault-tolerant.
        recordEvent({
            userId: result.insertId,
            eventType: 'register',
            ip: clientIpFrom(c),
            userAgent: c.req.header('user-agent')
        });
        return c.json({ message: 'User registered successfully', userId: result.insertId }, 201);
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return c.json({ error: 'Email already exists' }, 400);
        }
        return c.json({ error: 'Internal server error' }, 500);
    }
});

app.post('/api/auth/login', async (c) => {
    try {
        const { email, password } = await c.req.json();
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return c.json({ error: 'Invalid credentials' }, 401);
        }
        const user = users[0];
        const isMatch = await comparePassword(password, user.password_hash);
        if (!isMatch) {
            return c.json({ error: 'Invalid credentials' }, 401);
        }
        const token = generateToken({ id: user.id, role: user.role, email: user.email });
        setCookie(c, 'token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict',
            maxAge: 7 * 24 * 60 * 60
        });
        recordEvent({
            userId: user.id,
            eventType: 'login',
            ip: clientIpFrom(c),
            userAgent: c.req.header('user-agent')
        });
        return c.json({ message: 'Logged in successfully', user: { id: user.id, email: user.email, role: user.role } });
    } catch (error) {
        return c.json({ error: 'Internal server error' }, 500);
    }
});

app.post('/api/auth/logout', (c) => {
    // Decode the cookie if present so we can attribute the logout event.
    const token = getCookie(c, 'token');
    const tokenUser = token ? verifyToken(token) : null;
    deleteCookie(c, 'token');
    if (tokenUser?.id) {
        recordEvent({
            userId: tokenUser.id,
            eventType: 'logout',
            ip: clientIpFrom(c),
            userAgent: c.req.header('user-agent')
        });
    }
    return c.json({ message: 'Logged out successfully' });
});

app.get('/api/auth/me', authMiddleware, async (c) => {
    const tokenUser = c.get('user');
    try {
        const [rows] = await db.query(
            'SELECT id, email, role, subscription_status, subscription_expires_at, created_at FROM users WHERE id = ?',
            [tokenUser.id]
        );
        if (rows.length === 0) return c.json({ user: tokenUser });
        return c.json({ user: rows[0] });
    } catch (e) {
        console.error('auth/me db error:', e.message);
        return c.json({ user: tokenUser });
    }
});

// -------------- SUBSCRIPTION (mock) --------------
app.post('/api/auth/subscribe', authMiddleware, async (c) => {
    const userId = c.get('user').id;
    try {
        const [before] = await db.query(
            'SELECT subscription_status, subscription_expires_at FROM users WHERE id = ?',
            [userId]
        );
        const prev = before[0] || { subscription_status: 'inactive', subscription_expires_at: null };
        const now = new Date();
        const currentExpiry = prev.subscription_expires_at ? new Date(prev.subscription_expires_at) : null;
        const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
        const newExpiry = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);
        const newExpiryMysql = newExpiry.toISOString().slice(0, 19).replace('T', ' ');
        await db.query(
            'UPDATE users SET subscription_status = ?, subscription_expires_at = ? WHERE id = ?',
            ['active', newExpiryMysql, userId]
        );
        try {
            await db.query(
                `INSERT INTO subscription_history
                    (user_id, status_before, status_after, expires_at_before, expires_at_after, action_type)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    prev.subscription_status || 'inactive',
                    'active',
                    prev.subscription_expires_at,
                    newExpiryMysql,
                    prev.subscription_status === 'active' ? 'renew' : 'subscribe'
                ]
            );
        } catch (logErr) {
            console.error('subscription_history insert failed:', logErr.message);
        }
        recordEvent({
            userId,
            eventType: 'subscribe',
            ip: clientIpFrom(c),
            userAgent: c.req.header('user-agent'),
            metadata: {
                action: prev.subscription_status === 'active' ? 'renew' : 'subscribe',
                expires_at: newExpiryMysql
            }
        });
        return c.json({
            success: true,
            subscription_status: 'active',
            subscription_expires_at: newExpiryMysql
        });
    } catch (e) {
        console.error('subscribe error:', e.message);
        return c.json({ error: 'Subscription failed' }, 500);
    }
});

app.post('/api/auth/cancel', authMiddleware, async (c) => {
    const userId = c.get('user').id;
    try {
        const [before] = await db.query(
            'SELECT subscription_status, subscription_expires_at FROM users WHERE id = ?',
            [userId]
        );
        const prev = before[0] || { subscription_status: 'inactive', subscription_expires_at: null };
        await db.query(
            'UPDATE users SET subscription_status = ?, subscription_expires_at = NULL WHERE id = ?',
            ['inactive', userId]
        );
        try {
            await db.query(
                `INSERT INTO subscription_history
                    (user_id, status_before, status_after, expires_at_before, expires_at_after, action_type)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    prev.subscription_status || 'inactive',
                    'inactive',
                    prev.subscription_expires_at,
                    null,
                    'cancel'
                ]
            );
        } catch (logErr) {
            console.error('subscription_history insert failed:', logErr.message);
        }
        recordEvent({
            userId,
            eventType: 'cancel_subscription',
            ip: clientIpFrom(c),
            userAgent: c.req.header('user-agent')
        });
        return c.json({ success: true, subscription_status: 'inactive', subscription_expires_at: null });
    } catch (e) {
        console.error('cancel error:', e.message);
        return c.json({ error: 'Cancel failed' }, 500);
    }
});

// -------------- ANALYTICS INGEST --------------
// Frontend posts every interesting client-side event here. Authenticated
// users get attributed via the JWT cookie; logged-out traffic is still
// recorded with user_id = NULL.
//
// Body: { event_type, provider?, drama_id?, episode_id?, path?, metadata? }
app.post('/api/track', async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const token = getCookie(c, 'token');
        const tokenUser = token ? verifyToken(token) : null;
        await recordEvent({
            userId: tokenUser?.id || null,
            eventType: body.event_type,
            provider: body.provider || null,
            dramaId: body.drama_id || null,
            episodeId: body.episode_id || null,
            path: body.path ? String(body.path).slice(0, 255) : null,
            metadata: body.metadata || null,
            ip: clientIpFrom(c),
            userAgent: c.req.header('user-agent')
        });
        // Always 204 — tracking should be silent and never break the client.
        return c.body(null, 204);
    } catch (e) {
        console.error('[track]', e.message);
        return c.body(null, 204);
    }
});


// -------------- API PROXY (REAL) --------------
const BASE_URL = 'https://captain.sapimu.au';

// Captain's edge sometimes filters out clients that don't look like a browser
// (returns 403 / empty body). Setting a desktop-Chrome UA on every outbound
// request keeps things uniform across provider API calls, the media proxy,
// and the subtitle proxy.
const PROXY_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
export { PROXY_USER_AGENT };

// Map our short provider keys to the upstream path prefix on captain.
// Most providers use `/{provider}/api/v1/<path>`. A handful differ.
const PROVIDER_BASE_PATH = {
    bilitv: 'bilitv/api/v1',
    cubetv: 'cubetv',
    dramabite: 'dramabite/api/v1',
    dramawave: 'dramawave/api/v1',
    flextv: 'flextv/api/v1',
    flickreels: 'flickreels/api/v1',
    freereels: 'freereels/api/v1',
    melolo: 'melolo/api/v1',
    moboreels: 'moboreels/api',
    netshort: 'netshort/api/v1',
    pinedrama: 'pinedrama/api',
    rapidtv: 'rapidtv/api/v1',
    reelife: 'reelife/api/v1',
    reelshort: 'reelshort/api/v1',
    sarostv: 'sarostv/api',
    sereal: 'sereal/api',
    snackshort: 'snackshort/api/v1',
    stardust: 'stardusttv/api/v1',
    stardusttv: 'stardusttv/api/v1',
    starshort: 'starshort/api/v1',
    velolo: 'velolo',
    vigloo: 'vigloo/api/v1'
};

async function fetchProviderApi(provider, path, queryParams = {}) {
    const base = PROVIDER_BASE_PATH[provider] || `${provider}/api/v1`;
    const token = process.env[`${provider.toUpperCase()}_API_KEY`] || process.env.API_KEY;

    const url = new URL(`${BASE_URL}/${base}/${path}`);
    Object.entries(queryParams).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.append(k, v);
    });

    const urlString = url.toString();
    const cacheKey = `api_req:${urlString}`;

    const cachedResponse = await cache.get(cacheKey);
    if (cachedResponse) {
        console.log(`[Proxy] Cache hit: ${urlString}`);
        return cachedResponse;
    }

    console.log(`[Proxy] Fetching: ${urlString}`);

    const res = await fetch(urlString, {
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': PROXY_USER_AGENT
        }
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`[Proxy] API Error ${res.status}:`, text.slice(0, 200));
        throw new Error(`API Error: ${res.status}`);
    }

    const data = await res.json();
    // Cache successful responses for 15 minutes.
    await cache.set(cacheKey, data, 900);
    return data;
}

// Build a context object passed to provider adapters.
function buildAdapterCtx(c) {
    const lang = c.req.query('lang') || 'id';
    return {
        fetchApi: fetchProviderApi,
        lang,
        cache
    };
}

// -------------- CAPTAIN STATUS --------------
// Hit captain's /api/status to find out which upstreams are in maintenance.
// Cached for 60s so we don't hammer it on every page load.
async function fetchCaptainStatus() {
    const cacheKey = 'captain:status';
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const token = process.env.API_KEY;
    const res = await fetch(`${BASE_URL}/api/status`, {
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': PROXY_USER_AGENT
        }
    });
    if (!res.ok) {
        throw new Error(`Status fetch failed: ${res.status}`);
    }
    const data = await res.json();
    await cache.set(cacheKey, data, 60);
    return data;
}

// Public-ish endpoint the frontend polls to know which provider tiles to gray
// out. Returns the captain payload plus a normalized `byId` map keyed by the
// upstream provider id for cheap O(1) lookups.
app.get('/api/status', async (c) => {
    try {
        const data = await fetchCaptainStatus();
        const byId = {};
        for (const api of data.apis || []) {
            if (api?.id) byId[api.id] = !!api.maintenance;
        }
        return c.json({
            total: data.total ?? null,
            active: data.active ?? null,
            maintenance: data.maintenance ?? null,
            apis: data.apis || [],
            byId
        });
    } catch (e) {
        console.error('[status]', e.message);
        // Fail-open: empty list means the frontend treats every provider as
        // available rather than blocking the entire UI on a captain hiccup.
        return c.json({ total: null, active: null, maintenance: null, apis: [], byId: {} }, 200);
    }
});

// -------------- PROVIDERS LIST --------------
app.get('/api/providers', authMiddleware, async (c) => {
    let maintenanceById = {};
    try {
        const status = await fetchCaptainStatus();
        for (const api of status.apis || []) {
            if (api?.id) maintenanceById[api.id] = !!api.maintenance;
        }
    } catch (_) { /* fail-open: assume everything is up */ }

    const list = PROVIDER_LIST
        .filter(p => p !== 'stardust') // hide alias, keep canonical 'stardusttv'
        .map(id => ({
            id,
            name: getAdapter(id)?.name || id,
            // captain's stardusttv id matches ours; if a provider is missing
            // from captain's response we default to "not in maintenance".
            maintenance: maintenanceById[id] === true
        }));
    return c.json({ providers: list });
});

// -------------- HOME --------------
app.get('/api/home/:provider', authMiddleware, async (c) => {
    const { provider } = c.req.param();
    const adapter = getAdapter(provider);
    if (!adapter) return c.json({ error: 'Unknown provider' }, 400);
    try {
        const result = await adapter.home(buildAdapterCtx(c));
        return c.json(result);
    } catch (e) {
        console.error(`[home/${provider}]`, e.message);
        return c.json({ error: e.message, dramas: [] }, 502);
    }
});

// -------------- SEARCH --------------
app.get('/api/search/:provider', authMiddleware, async (c) => {
    const { provider } = c.req.param();
    const q = c.req.query('q') || c.req.query('keyword') || '';
    const adapter = getAdapter(provider);
    if (!adapter) return c.json({ error: 'Unknown provider' }, 400);
    try {
        const result = await adapter.search(buildAdapterCtx(c), q);
        return c.json(result);
    } catch (e) {
        console.error(`[search/${provider}]`, e.message);
        return c.json({ error: e.message, dramas: [] }, 502);
    }
});

// -------------- CATEGORIES --------------
app.get('/api/categories/:provider', authMiddleware, async (c) => {
    const { provider } = c.req.param();
    const adapter = getAdapter(provider);
    if (!adapter) return c.json({ error: 'Unknown provider' }, 400);
    try {
        const result = await adapter.categories(buildAdapterCtx(c));
        return c.json(result);
    } catch (e) {
        console.error(`[categories/${provider}]`, e.message);
        return c.json({ error: e.message, categories: [] }, 502);
    }
});

app.get('/api/category-content/:provider', authMiddleware, async (c) => {
    const { provider } = c.req.param();
    const id = c.req.query('id') || '';
    const name = c.req.query('name') || '';
    const adapter = getAdapter(provider);
    if (!adapter) return c.json({ error: 'Unknown provider' }, 400);
    try {
        const result = await adapter.categoryContent(buildAdapterCtx(c), { id, name });
        return c.json(result);
    } catch (e) {
        console.error(`[category-content/${provider}]`, e.message);
        return c.json({ error: e.message, dramas: [] }, 502);
    }
});

// -------------- DETAIL --------------
app.get('/api/detail/:provider/:id', authMiddleware, async (c) => {
    const { provider, id } = c.req.param();
    const adapter = getAdapter(provider);
    if (!adapter) return c.json({ error: 'Unknown provider' }, 400);
    try {
        const result = await adapter.detail(buildAdapterCtx(c), id);
        return c.json(result);
    } catch (e) {
        console.error(`[detail/${provider}/${id}]`, e.message);
        return c.json({ error: e.message }, 502);
    }
});

// -------------- VIDEO STREAM --------------
// Returns the proxied playback URL plus a list of subtitle tracks.
//
// Response shape:
//   {
//     source: "/api/proxy-media?url=...",
//     subtitles: [
//       { language, label, url, format }   // url already proxied through /api/subtitle
//     ],
//     qualities: { "720p": "/api/proxy-media?url=...", ... },
//     fromCache: bool
//   }
// Many provider CDNs sign their URLs with an `exp=<unix-timestamp>` token
// (sometimes `Expires=<unix-timestamp>`). Pull out the earliest expiry and
// return seconds-from-now. If none is found, return null (caller decides the
// default TTL).
function extractUrlExpirySeconds(url) {
    if (!url) return null;
    const candidates = [];
    // exp=1779110606  (commonly inside a path/query token)
    const expMatch = url.match(/[?&_-]exp(?:ires)?[=:](\d{9,11})/i);
    if (expMatch) candidates.push(parseInt(expMatch[1], 10));
    // Expires=...  (CloudFront / generic)
    const expiresMatch = url.match(/[?&]Expires=(\d{9,11})/);
    if (expiresMatch) candidates.push(parseInt(expiresMatch[1], 10));
    // x-expires=... (TikTok-style)
    const xexpMatch = url.match(/[?&]x-expires=(\d{9,11})/i);
    if (xexpMatch) candidates.push(parseInt(xexpMatch[1], 10));
    if (!candidates.length) return null;
    const earliest = Math.min(...candidates);
    const nowSec = Math.floor(Date.now() / 1000);
    return earliest - nowSec;
}

app.get('/api/video/:provider/:dramaId/:episodeId', authMiddleware, async (c) => {
    const { provider, dramaId, episodeId } = c.req.param();
    const resParam = c.req.query('res');
    const langParam = c.req.query('lang') || 'id';
    // ?refresh=1 lets the frontend bypass the cache when an upstream signed
    // URL has expired and playback is failing with 403/404.
    const refresh = c.req.query('refresh') === '1';

    const adapter = getAdapter(provider);
    if (!adapter) return c.json({ error: 'Unknown provider' }, 400);

    // Per README: flickreels has 30 min TTL, stardust is permanent. Other
    // providers default to 30 min for safety. The cached value is the entire
    // normalized stream payload (source + qualities + subtitles).
    const baseTtl = provider === 'stardusttv' || provider === 'stardust' ? null : 1800;
    const cacheKey = `stream:${provider}:${dramaId}:${episodeId}:${resParam || 'default'}:${langParam}`;

    if (!refresh) {
        const cached = await cache.get(cacheKey);
        if (cached) {
            return c.json({ ...cached, fromCache: true });
        }
    } else {
        // Best-effort eviction; downstream cache.set below also overwrites it.
        try { await cache.client?.del?.(cacheKey); } catch (_) { /* ignore */ }
    }

    try {
        const ctx = buildAdapterCtx(c);
        const result = await adapter.stream(ctx, dramaId, episodeId, { res: resParam, lang: langParam });
        if (!result?.source) {
            return c.json({ error: 'No stream URL available' }, 502);
        }

        // Wrap real URLs through our media/subtitle proxies.
        const proxiedSource = `/api/proxy-media?url=${encodeURIComponent(result.source)}`;
        const proxiedQualities = {};
        for (const [k, v] of Object.entries(result.qualities || {})) {
            if (v) proxiedQualities[k] = `/api/proxy-media?url=${encodeURIComponent(v)}`;
        }
        const proxiedSubs = (result.subtitles || []).map(s => ({
            language: s.language,
            label: s.label,
            url: `/api/subtitle?url=${encodeURIComponent(s.url)}`,
            format: 'vtt' // we always serve VTT (transcoded if needed)
        }));

        const payload = {
            source: proxiedSource,
            qualities: proxiedQualities,
            subtitles: proxiedSubs,
            fromCache: false
        };

        // Compute the actual TTL: clamp to whatever signed-URL `exp` we
        // detected (minus a 60s safety buffer) so we never hand a client a
        // URL that's already dead. Stardust stays permanent.
        let ttl = baseTtl;
        if (ttl !== null) {
            const urlExpiry = extractUrlExpirySeconds(result.source);
            if (urlExpiry !== null && urlExpiry > 60) {
                ttl = Math.min(ttl, urlExpiry - 60);
            } else if (urlExpiry !== null && urlExpiry <= 60) {
                // Already-expired or about-to-expire URL: don't cache at all.
                ttl = 1;
            }
        }

        // Only cache the normalized payload (not the wrapper), so we can
        // reconstruct fromCache=true cheaply.
        await cache.set(cacheKey, {
            source: proxiedSource,
            qualities: proxiedQualities,
            subtitles: proxiedSubs
        }, ttl);

        return c.json(payload);
    } catch (e) {
        console.error(`[video/${provider}]`, e.message);
        return c.json({ error: 'Bad Gateway' }, 502);
    }
});


// -------------- MEDIA PROXY (Bypass CORS + Auth) --------------
//
// This endpoint is the single chokepoint that fetches every piece of upstream
// media (MP4 / HLS playlist / TS segment / fMP4 init / DRM-free fragmented
// MP4) and re-emits it to the browser with permissive CORS. It also lets
// adapters smuggle authentication context to upstream by encoding it into
// query parameters that we strip *before* forwarding:
//
//   __dr_cookies  base64(JSON {name:value}) -> serialised into Cookie:
//   __dr_headers  base64(JSON {Header: value}) -> arbitrary request headers
//                 (e.g. Referer, Origin, Authorization, X-Custom-Token).
//
// All `__dr_*` params are scrubbed before the request reaches the CDN, and
// re-attached to nested URLs we discover inside an HLS manifest so child
// segments inherit the same auth context. If the adapter doesn't supply a
// Referer/Origin we synthesise one from the URL's own origin which is enough
// to satisfy the most common "referer-locked" CDNs.
const INTERNAL_PARAMS = ['__dr_cookies', '__dr_headers'];

// Hop-by-hop headers + a few headers that must come from `fetch` itself; we
// never forward these from the browser request to the upstream.
const HOP_BY_HOP = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade',
    'host', 'content-length', 'accept-encoding'
]);

function decodeB64Json(b64) {
    if (!b64) return null;
    try {
        const obj = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
        return obj && typeof obj === 'object' ? obj : null;
    } catch (_) {
        return null;
    }
}

// `__dr_cookies` (when present, base64-encoded JSON of {name: value} pairs)
// is stripped from the upstream URL we forward and instead serialised into
// a `Cookie:` header. Some signed CDNs (CloudFront for vigloo) require this.
function buildCookieHeader(b64) {
    const obj = decodeB64Json(b64);
    if (!obj) return '';
    return Object.entries(obj)
        .filter(([k, v]) => k && v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
}

// Decode `__dr_headers` (base64 JSON) into a plain {Header: value} object.
function buildExtraHeaders(b64) {
    const obj = decodeB64Json(b64);
    if (!obj) return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (!k || v === undefined || v === null) continue;
        // Disallow hop-by-hop overrides from sneaking in via the encoded blob.
        if (HOP_BY_HOP.has(k.toLowerCase())) continue;
        out[k] = String(v);
    }
    return out;
}

// Synthesise a sensible default Referer/Origin from the target URL itself.
// Lots of CDNs (especially in CN/SEA region) only check that *something*
// is present and that it matches the upstream host, so URL.origin works.
function defaultRefererFor(url) {
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.host}/`;
    } catch (_) {
        return '';
    }
}

function defaultOriginFor(url) {
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.host}`;
    } catch (_) {
        return '';
    }
}

// Strip our private query parameters from the URL we hand back to the
// upstream CDN. They were ours, not theirs.
function stripInternalParams(rawUrl) {
    try {
        const u = new URL(rawUrl);
        for (const p of INTERNAL_PARAMS) u.searchParams.delete(p);
        return u.toString();
    } catch (_) {
        return rawUrl;
    }
}

// Standard CORS headers we attach to every proxy response. We use `*` because
// the proxy must be reachable from any origin (file:// players, mobile
// webview, etc.) and we never forward the user's cookies upstream.
function applyCorsHeaders(headers) {
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Origin, Referer, User-Agent, Authorization');
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type, Accept-Ranges, ETag, Last-Modified, Date');
    headers.set('Access-Control-Max-Age', '86400');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    headers.set('Timing-Allow-Origin', '*');
}

// CORS preflight. Browsers send OPTIONS for any cross-origin Range request
// and a 403/redirect here breaks HLS playback completely.
app.options('/api/proxy-media', (c) => {
    const headers = new Headers();
    applyCorsHeaders(headers);
    return new Response(null, { status: 204, headers });
});

async function handleProxyMedia(c, { method }) {
    const targetUrl = c.req.query('url');
    if (!targetUrl) {
        const headers = new Headers();
        applyCorsHeaders(headers);
        return new Response('Missing URL', { status: 400, headers });
    }

    // Pull __dr_cookies / __dr_headers out of the target URL (if any) before
    // forwarding. Whatever is left becomes the real upstream URL.
    let cleanedTargetUrl = targetUrl;
    let cookieHeader = '';
    let extraHeaders = {};
    try {
        const u = new URL(targetUrl);
        const drC = u.searchParams.get('__dr_cookies');
        const drH = u.searchParams.get('__dr_headers');
        if (drC) cookieHeader = buildCookieHeader(drC);
        if (drH) extraHeaders = buildExtraHeaders(drH);
        for (const p of INTERNAL_PARAMS) u.searchParams.delete(p);
        cleanedTargetUrl = u.toString();
    } catch (_) { /* leave url as-is */ }

    try {
        // Build the upstream request headers. Order matters: defaults first,
        // then explicit `__dr_headers` overrides win (case-insensitive).
        const upstreamHeaders = new Headers();
        upstreamHeaders.set('User-Agent', PROXY_USER_AGENT);
        upstreamHeaders.set('Accept', '*/*');
        upstreamHeaders.set('Accept-Language', 'en-US,en;q=0.9,id;q=0.8');

        // Auto-Referer / Origin so referer-locked CDNs accept the request.
        const autoReferer = defaultRefererFor(cleanedTargetUrl);
        const autoOrigin = defaultOriginFor(cleanedTargetUrl);
        if (autoReferer) upstreamHeaders.set('Referer', autoReferer);
        if (autoOrigin) upstreamHeaders.set('Origin', autoOrigin);

        // Forward the browser's Range header so seek/partial requests work.
        const range = c.req.header('range');
        if (range) upstreamHeaders.set('Range', range);

        if (cookieHeader) upstreamHeaders.set('Cookie', cookieHeader);

        // Adapter-supplied headers always take precedence (e.g. a provider
        // that requires a very specific Referer or Authorization).
        for (const [k, v] of Object.entries(extraHeaders)) {
            upstreamHeaders.set(k, v);
        }

        const response = await fetch(cleanedTargetUrl, {
            method: method === 'HEAD' ? 'HEAD' : 'GET',
            headers: upstreamHeaders,
            redirect: 'follow'
        });
        if (!response.ok && response.status !== 206) {
            const headers = new Headers();
            applyCorsHeaders(headers);
            return new Response(`Failed to fetch media: ${response.status}`, {
                status: response.status,
                headers
            });
        }

        const contentType = response.headers.get('content-type') || '';
        const isManifest =
            cleanedTargetUrl.toLowerCase().includes('.m3u8') ||
            contentType.includes('mpegurl') ||
            contentType.includes('x-mpegurl');

        if (isManifest && method !== 'HEAD') {
            let m3u8Content = await response.text();
            const baseUrl = new URL(cleanedTargetUrl);

            // Helper: re-attach __dr_cookies / __dr_headers so child segments
            // and variant playlists keep authenticating with the same context.
            const wrap = (absoluteUri) => {
                const full = appendInternalParams(absoluteUri, /*from=*/ targetUrl);
                return `/api/proxy-media?url=${encodeURIComponent(full)}`;
            };

            const lines = m3u8Content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line && !line.startsWith('#')) {
                    try {
                        const absoluteUri = new URL(line, baseUrl).toString();
                        lines[i] = wrap(absoluteUri);
                    } catch (_) { /* skip */ }
                } else if (
                    line.startsWith('#EXT-X-STREAM-INF:') ||
                    line.startsWith('#EXT-X-I-FRAME-STREAM-INF:') ||
                    line.startsWith('#EXT-X-MEDIA:') ||
                    line.startsWith('#EXT-X-MAP:') ||
                    line.startsWith('#EXT-X-KEY:') ||
                    line.startsWith('#EXT-X-SESSION-KEY:') ||
                    line.startsWith('#EXT-X-PART:') ||
                    line.startsWith('#EXT-X-PRELOAD-HINT:')
                ) {
                    // Rewrite every URI="..." attribute on the line. Some tags
                    // (#EXT-X-MAP, #EXT-X-KEY) carry a single URI; #EXT-X-MEDIA
                    // can have one. Using a global replace keeps this generic.
                    lines[i] = line.replace(/URI="([^"]+)"/g, (_m, u) => {
                        try {
                            const absoluteUri = new URL(u, baseUrl).toString();
                            return `URI="${wrap(absoluteUri)}"`;
                        } catch (_) {
                            return `URI="${u}"`;
                        }
                    });
                }
            }

            const headers = new Headers();
            applyCorsHeaders(headers);
            headers.set('Content-Type', 'application/vnd.apple.mpegurl');
            headers.set('Cache-Control', 'no-store');
            return new Response(lines.join('\n'), { status: 200, headers });
        }

        // Forward useful upstream headers (length, ranges, ETag/Last-Modified)
        // so the browser's range player can seek without us re-buffering. We
        // explicitly *don't* forward `Transfer-Encoding` / `Connection`
        // because they're hop-by-hop; leaving them in place sometimes makes
        // the dev-server proxy fail with "Invalid character in chunk size".
        const passthroughHeaders = new Headers();
        applyCorsHeaders(passthroughHeaders);
        passthroughHeaders.set('Content-Type', contentType || 'application/octet-stream');
        passthroughHeaders.set('Accept-Ranges', 'bytes');
        for (const k of ['content-length', 'content-range', 'etag', 'last-modified', 'cache-control']) {
            const v = response.headers.get(k);
            if (v) passthroughHeaders.set(k, v);
        }

        return new Response(method === 'HEAD' ? null : response.body, {
            status: response.status, // preserve 200 / 206
            headers: passthroughHeaders
        });
    } catch (e) {
        const headers = new Headers();
        applyCorsHeaders(headers);
        return new Response(`Media Proxy Error: ${e.message}`, { status: 500, headers });
    }
}

app.get('/api/proxy-media', (c) => handleProxyMedia(c, { method: 'GET' }));
app.on('HEAD', '/api/proxy-media', (c) => handleProxyMedia(c, { method: 'HEAD' }));

// Copy the original request's `__dr_cookies` / `__dr_headers` query strings
// onto a child URL so nested manifest entries (variant playlists, segments,
// audio/subtitle tracks, encryption keys) inherit the same auth context on
// their way back through the proxy.
function appendInternalParams(childUrl, originalProxyInputUrl) {
    try {
        const orig = new URL(originalProxyInputUrl);
        const child = new URL(childUrl);
        let touched = false;
        for (const p of INTERNAL_PARAMS) {
            const v = orig.searchParams.get(p);
            if (v && !child.searchParams.has(p)) {
                child.searchParams.set(p, v);
                touched = true;
            }
        }
        return touched ? child.toString() : childUrl;
    } catch (_) {
        return childUrl;
    }
}

// Backwards-compatible alias; older code paths still call appendDrCookies.
const appendDrCookies = appendInternalParams;


// -------------- SUBTITLE PROXY (SRT -> VTT) --------------
// Frontend always loads subtitles via this endpoint, which transcodes SRT to
// WebVTT on the fly. Result is cached for 24h since subtitle files are stable.
app.get('/api/subtitle', async (c) => {
    const targetUrl = c.req.query('url');
    if (!targetUrl) return c.text('Missing URL', 400);

    const cacheKey = `subtitle:${targetUrl}`;
    const cached = await cache.get(cacheKey);
    if (cached?.body) {
        c.header('Content-Type', cached.contentType || 'text/vtt; charset=utf-8');
        c.header('Access-Control-Allow-Origin', '*');
        c.header('Cache-Control', 'public, max-age=86400');
        return c.text(cached.body);
    }

    try {
        const { body, contentType } = await fetchSubtitleAsVtt(targetUrl);
        await cache.set(cacheKey, { body, contentType }, 86400);
        c.header('Content-Type', contentType);
        c.header('Access-Control-Allow-Origin', '*');
        c.header('Cache-Control', 'public, max-age=86400');
        return c.text(body);
    } catch (e) {
        console.error('[subtitle proxy]', e.message);
        return c.text(`Subtitle proxy error: ${e.message}`, 502);
    }
});

// -------------- HISTORY & BOOKMARKS --------------
app.post('/api/history/update', authMiddleware, async (c) => {
    try {
        const { drama_id, episode_id, last_position_seconds } = await c.req.json();
        const userId = c.get('user').id;
        await db.query(`
            INSERT INTO watch_history (user_id, drama_id, episode_id, last_position_seconds)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE last_position_seconds = ?, updated_at = CURRENT_TIMESTAMP
        `, [userId, drama_id, episode_id, last_position_seconds, last_position_seconds]);
        return c.json({ success: true });
    } catch (error) {
        return c.json({ error: 'Database error' }, 500);
    }
});

app.get('/api/history', authMiddleware, async (c) => {
    try {
        const userId = c.get('user').id;
        const [history] = await db.query('SELECT * FROM watch_history WHERE user_id = ? ORDER BY updated_at DESC', [userId]);
        return c.json({ history });
    } catch (e) {
        console.error("History fetch error:", e);
        return c.json({ error: e.message }, 500);
    }
});

// -------------- ADMIN ANALYTICS --------------
//
// All endpoints below require the requester's JWT to carry `role: 'admin'`
// (enforced by `isAdmin`). Each one returns a small JSON payload so the
// frontend can render a card or chart without any extra processing.
//
// Common query param:
//   ?days=N   window in days (default 30, capped 1..365)
function parseDays(c) {
    const raw = parseInt(c.req.query('days') || '30', 10);
    if (!Number.isFinite(raw)) return 30;
    return Math.min(365, Math.max(1, raw));
}

// Big-number cards + DAU at the top of the dashboard.
app.get('/api/admin/analytics/overview', authMiddleware, isAdmin, async (c) => {
    try {
        const days = parseDays(c);
        const overview = await getOverview(days);
        return c.json(overview);
    } catch (e) {
        console.error('[admin/analytics/overview]', e.message);
        return c.json({ error: 'Database error' }, 500);
    }
});

// Time series for the main chart: registrations / views / active users per day.
app.get('/api/admin/analytics/timeseries', authMiddleware, isAdmin, async (c) => {
    try {
        const days = parseDays(c);
        const series = await getDailySeries(days);
        return c.json(series);
    } catch (e) {
        console.error('[admin/analytics/timeseries]', e.message);
        return c.json({ error: 'Database error' }, 500);
    }
});

// Top dramas table.
app.get('/api/admin/analytics/top-content', authMiddleware, isAdmin, async (c) => {
    try {
        const days = parseDays(c);
        const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '10', 10) || 10));
        const items = await getTopContent(days, limit);
        return c.json({ items });
    } catch (e) {
        console.error('[admin/analytics/top-content]', e.message);
        return c.json({ error: 'Database error' }, 500);
    }
});

// Subscription funnel summary.
app.get('/api/admin/analytics/subscriptions', authMiddleware, isAdmin, async (c) => {
    try {
        const days = parseDays(c);
        const data = await getSubscriptionFunnel(days);
        return c.json(data);
    } catch (e) {
        console.error('[admin/analytics/subscriptions]', e.message);
        return c.json({ error: 'Database error' }, 500);
    }
});

// Event-type breakdown (donut).
app.get('/api/admin/analytics/events', authMiddleware, isAdmin, async (c) => {
    try {
        const days = parseDays(c);
        const items = await getEventBreakdown(days);
        return c.json({ items });
    } catch (e) {
        console.error('[admin/analytics/events]', e.message);
        return c.json({ error: 'Database error' }, 500);
    }
});

// Provider popularity.
app.get('/api/admin/analytics/providers', authMiddleware, isAdmin, async (c) => {
    try {
        const days = parseDays(c);
        const items = await getProviderBreakdown(days);
        return c.json({ items });
    } catch (e) {
        console.error('[admin/analytics/providers]', e.message);
        return c.json({ error: 'Database error' }, 500);
    }
});

// -------------- ADMIN CACHE TOOLS --------------
// Flush every cache entry that mentions the given provider id. Useful after
// patching a broken adapter so the next request doesn't get served stale
// upstream JSON / a stale stream URL.
//
//   POST /api/admin/cache/flush                 -> flush captain status only
//   POST /api/admin/cache/flush?provider=velolo -> flush all velolo keys
//   POST /api/admin/cache/flush?provider=all    -> flush every api_req + stream key
app.post('/api/admin/cache/flush', authMiddleware, isAdmin, async (c) => {
    const provider = (c.req.query('provider') || '').trim().toLowerCase();
    const patterns = [];

    if (!provider) {
        // Just the captain-status snapshot.
        patterns.push('captain:status');
    } else if (provider === 'all') {
        patterns.push('api_req:*', 'stream:*', 'subtitle:*', 'captain:status');
    } else {
        // The api_req: keys are full URLs that contain the provider slug, so
        // a substring match works. The stream: keys start with stream:<provider>:.
        patterns.push(`api_req:*${provider}*`, `stream:${provider}:*`, 'captain:status');
    }

    let total = 0;
    const perPattern = {};
    for (const pat of patterns) {
        try {
            const n = await cache.delByPattern(pat);
            perPattern[pat] = n;
            total += n;
        } catch (e) {
            perPattern[pat] = `error: ${e.message}`;
        }
    }
    return c.json({ ok: true, provider: provider || null, deleted: total, perPattern });
});

// Run with Bun
export default {
    port: process.env.PORT || 3000,
    fetch: app.fetch,
};
