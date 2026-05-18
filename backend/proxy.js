import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { db } from './db.js';
import { cache } from './cache.js';
import { hashPassword, comparePassword, generateToken, authMiddleware, isAdmin } from './auth.js';
import { getAdapter, PROVIDER_LIST } from './providers.js';
import { fetchSubtitleAsVtt, isSrtUrl } from './subtitle.js';

const app = new Hono();

// Connect to Redis on startup
cache.connect();

// -------------- AUTH ROUTES --------------
app.post('/api/auth/register', async (c) => {
    try {
        const { email, password } = await c.req.json();
        const hashedPassword = await hashPassword(password);
        const [result] = await db.query(
            'INSERT INTO users (email, password_hash) VALUES (?, ?)',
            [email, hashedPassword]
        );
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
        return c.json({ message: 'Logged in successfully', user: { id: user.id, email: user.email, role: user.role } });
    } catch (error) {
        return c.json({ error: 'Internal server error' }, 500);
    }
});

app.post('/api/auth/logout', (c) => {
    deleteCookie(c, 'token');
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
        return c.json({ success: true, subscription_status: 'inactive', subscription_expires_at: null });
    } catch (e) {
        console.error('cancel error:', e.message);
        return c.json({ error: 'Cancel failed' }, 500);
    }
});


// -------------- API PROXY (REAL) --------------
const BASE_URL = 'https://captain.sapimu.au';

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
            'Authorization': `Bearer ${token}`
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

// -------------- PROVIDERS LIST --------------
app.get('/api/providers', authMiddleware, (c) => {
    const list = PROVIDER_LIST
        .filter(p => p !== 'stardust') // hide alias, keep canonical 'stardusttv'
        .map(id => ({ id, name: getAdapter(id)?.name || id }));
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
app.get('/api/video/:provider/:dramaId/:episodeId', authMiddleware, async (c) => {
    const { provider, dramaId, episodeId } = c.req.param();
    const resParam = c.req.query('res');
    const langParam = c.req.query('lang') || 'id';

    const adapter = getAdapter(provider);
    if (!adapter) return c.json({ error: 'Unknown provider' }, 400);

    // Per README: flickreels has 30 min TTL, stardust is permanent. Other
    // providers default to 30 min for safety. The cached value is the entire
    // normalized stream payload (source + qualities + subtitles).
    const ttl = provider === 'stardusttv' || provider === 'stardust' ? null : 1800;
    const cacheKey = `stream:${provider}:${dramaId}:${episodeId}:${resParam || 'default'}:${langParam}`;

    const cached = await cache.get(cacheKey);
    if (cached) {
        return c.json({ ...cached, fromCache: true });
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

// -------------- MEDIA PROXY (Bypass CORS) --------------
app.get('/api/proxy-media', async (c) => {
    const targetUrl = c.req.query('url');
    if (!targetUrl) return c.text('Missing URL', 400);

    try {
        const response = await fetch(targetUrl);
        if (!response.ok) {
            return c.text(`Failed to fetch media: ${response.status}`, response.status);
        }

        const contentType = response.headers.get('content-type') || '';

        if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegURL')) {
            let m3u8Content = await response.text();
            const baseUrl = new URL(targetUrl);

            const lines = m3u8Content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line && !line.startsWith('#')) {
                    try {
                        const absoluteUri = new URL(line, baseUrl).toString();
                        lines[i] = `/api/proxy-media?url=${encodeURIComponent(absoluteUri)}`;
                    } catch (_) { /* skip */ }
                } else if (line.startsWith('#EXT-X-STREAM-INF:') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF:') || line.startsWith('#EXT-X-MEDIA:')) {
                    const uriMatch = line.match(/URI="([^"]+)"/);
                    if (uriMatch) {
                        try {
                            const absoluteUri = new URL(uriMatch[1], baseUrl).toString();
                            const proxyUri = `/api/proxy-media?url=${encodeURIComponent(absoluteUri)}`;
                            lines[i] = line.replace(`URI="${uriMatch[1]}"`, `URI="${proxyUri}"`);
                        } catch (_) { /* skip */ }
                    }
                }
            }

            c.header('Content-Type', 'application/vnd.apple.mpegurl');
            c.header('Access-Control-Allow-Origin', '*');
            return c.text(lines.join('\n'));
        }

        c.header('Content-Type', contentType || 'application/octet-stream');
        c.header('Access-Control-Allow-Origin', '*');
        return new Response(response.body, {
            status: 200,
            headers: c.res.headers
        });
    } catch (e) {
        return c.text(`Media Proxy Error: ${e.message}`, 500);
    }
});

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
app.get('/api/admin/analytics/overview', authMiddleware, isAdmin, async (c) => {
    try {
        const [usersCount] = await db.query('SELECT COUNT(*) as total FROM users');
        const [viewsCount] = await db.query('SELECT COUNT(*) as total FROM watch_history');
        const dailyActiveUsers = [120, 150, 180, 190, 210, 250, 300];
        const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        return c.json({
            totalUsers: usersCount[0].total,
            totalViews: viewsCount[0].total,
            chartData: { labels, data: dailyActiveUsers }
        });
    } catch (error) {
        return c.json({ error: 'Database error' }, 500);
    }
});

// Run with Bun
export default {
    port: process.env.PORT || 3000,
    fetch: app.fetch,
};
