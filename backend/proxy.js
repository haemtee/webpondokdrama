import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { setCookie, deleteCookie } from 'hono/cookie';
import { db } from './db.js';
import { cache } from './cache.js';
import { hashPassword, comparePassword, generateToken, authMiddleware, isAdmin } from './auth.js';

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
            maxAge: 7 * 24 * 60 * 60 // 7 days
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

app.get('/api/auth/me', authMiddleware, (c) => {
    return c.json({ user: c.get('user') });
});

// -------------- API PROXY (REAL) --------------
const BASE_URL = 'https://captain.sapimu.au';

async function fetchProviderApi(provider, path, queryParams = {}) {
    const token = (provider === 'flickreels' ? process.env.FLICKREELS_API_KEY : process.env.STARDUST_API_KEY) || process.env.API_KEY;
    const url = new URL(`${BASE_URL}/${provider}/api/v1/${path}`);
    Object.entries(queryParams).forEach(([k, v]) => {
        if (v) url.searchParams.append(k, v);
    });

    const urlString = url.toString();
    const cacheKey = `api_req:${urlString}`;
    
    // Check cache first
    const cachedResponse = await cache.get(cacheKey);
    if (cachedResponse) {
        console.log(`[Proxy] Cache hit: ${urlString}`);
        return cachedResponse;
    }

    console.log(`[Proxy] Fetching: ${urlString}`);
    
    try {
        const res = await fetch(urlString, {
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!res.ok) {
            const text = await res.text();
            console.error(`[Proxy] API Error ${res.status}:`, text);
            throw new Error(`API Error: ${res.status}`);
        }
        
        const data = await res.json();
        
        // Cache the successful response for 15 minutes (900 seconds)
        await cache.set(cacheKey, data, 900);
        
        return data;
    } catch (e) {
        console.error(`[Proxy] Fetch failed: ${e.message}`);
        throw e;
    }
}

app.get('/api/home/:provider', authMiddleware, async (c) => {
    const { provider } = c.req.param();
    const lang = c.req.query('lang') || 'id';
    
    try {
        if (provider === 'flickreels') {
            const data = await fetchProviderApi(provider, 'for-you', { page: 1, page_size: 10, lang });
            // Normalize data format for frontend
            const list = data.data?.list || [];
            return c.json({ dramas: list.map(d => ({
                id: d.playlet_id,
                title: d.playlet_title,
                poster: d.cover,
                episode_count: d.chapter_num
            })) });
        } else if (provider === 'stardust') {
            const data = await fetchProviderApi('stardusttv', 'homepage', { lang });
            const list = data.data || [];
            return c.json({ dramas: list.map(d => ({
                id: d.id,
                title: d.title,
                poster: d.poster,
                episode_count: d.episode || '?'
            })) });
        }
        return c.json({ error: 'Unknown provider' }, 400);
    } catch (e) {
        return c.json({ error: e.message }, 502);
    }
});

app.get('/api/search/:provider', authMiddleware, async (c) => {
    const { provider } = c.req.param();
    const q = c.req.query('q') || c.req.query('keyword');
    const lang = c.req.query('lang') || 'id';
    try {
        if (provider === 'flickreels') {
            const data = await fetchProviderApi(provider, 'search', { keyword: q, lang });
            const list = data.data?.list || [];
            return c.json({ dramas: list.map(d => ({
                id: d.playlet_id,
                title: d.playlet_title,
                poster: d.cover,
                episode_count: d.chapter_num
            })) });
        } else if (provider === 'stardust') {
            const data = await fetchProviderApi('stardusttv', 'search', { q, lang, page: 1, page_size: 20 });
            const list = data.data?.data || data.data || [];
            return c.json({ dramas: list.map(d => ({
                id: d.id,
                title: d.title,
                poster: d.poster,
                episode_count: d.episode || '?'
            })) });
        }
        return c.json({ error: 'Unknown provider' }, 400);
    } catch (e) {
        return c.json({ error: e.message }, 502);
    }
});

app.get('/api/category-content/:provider', authMiddleware, async (c) => {
    const { provider } = c.req.param();
    const catId = c.req.query('id');
    const catName = (c.req.query('name') || '').toLowerCase();
    const lang = c.req.query('lang') || 'id';
    
    try {
        if (provider === 'flickreels') {
            let path = 'category';
            let params = { lang, page: 1, page_size: 20 };
            
            if (catName.includes('for you') || catName.includes('home') || catName.includes('baru') || catId === '1') {
                path = 'for-you';
            } else if (catName.includes('rank') || catName.includes('peringkat')) {
                path = 'hot-rank';
            } else {
                params.navigation_id = catId;
            }
            
            const data = await fetchProviderApi(provider, path, params);
            const list = data.data?.list || data.data || [];
            return c.json({ dramas: list.map(d => ({
                id: d.playlet_id || d.id,
                title: d.playlet_title || d.title,
                poster: d.cover || d.poster,
                episode_count: d.chapter_num || d.episode || '?'
            })) });
        } else if (provider === 'stardust') {
            const data = await fetchProviderApi('stardusttv', `category/${catId}`, { lang }).catch(() => null);
            let list = data?.data?.data || data?.data || [];
            
            if (!list.length) {
                 const fallback = await fetchProviderApi('stardusttv', 'search', { q: catName, lang, page:1, page_size:20 });
                 list = fallback.data?.data || fallback.data || [];
            }
            
            return c.json({ dramas: list.map(d => ({
                id: d.id,
                title: d.title,
                poster: d.poster,
                episode_count: d.episode || '?'
            })) });
        }
        return c.json({ error: 'Unknown provider' }, 400);
    } catch (e) {
        return c.json({ error: e.message }, 502);
    }
});

app.get('/api/categories/:provider', authMiddleware, async (c) => {
    const { provider } = c.req.param();
    const lang = c.req.query('lang') || 'id';
    try {
        if (provider === 'flickreels') {
            const data = await fetchProviderApi(provider, 'navigation', { lang });
            // flickreels returns array in data.data
            const list = data.data || [];
            return c.json({ categories: list });
        } else if (provider === 'stardust') {
            const data = await fetchProviderApi('stardusttv', 'categories', { lang });
            // stardust returns array in data.data
            const list = data.data || [];
            return c.json({ categories: list });
        }
        return c.json({ error: 'Unknown provider' }, 400);
    } catch (e) {
        return c.json({ error: e.message, stack: e.stack }, 502);
    }
});

app.get('/api/detail/:provider/:id', authMiddleware, async (c) => {
    const { provider, id } = c.req.param();
    const lang = c.req.query('lang') || 'id';
    
    try {
        if (provider === 'flickreels') {
            const data = await fetchProviderApi(provider, `chapters/${id}`, { lang });
            const info = data.data || {};
            // Flickreels typically doesn't provide a long intro here, but has title, cover, list
            return c.json({
                id: info.playlet_id,
                title: info.title,
                poster: info.cover,
                intro: info.desc || 'Deskripsi tidak tersedia.',
                totalEpisodes: info.list?.length || 0,
                tags: [] // Can fetch tags from play/ endpoint if needed, but keeping simple for now
            });
        } else if (provider === 'stardust') {
            const data = await fetchProviderApi('stardusttv', `video/${id}`, { lang });
            const info = data.data || {};
            return c.json({
                id: info.id,
                title: info.title,
                poster: info.poster,
                intro: info.intro || 'Deskripsi tidak tersedia.',
                totalEpisodes: info.totalEpisodes || info.episodes?.length || 0,
                tags: []
            });
        }
        return c.json({ error: 'Unknown provider' }, 400);
    } catch (e) {
        return c.json({ error: e.message }, 502);
    }
});

// -------------- VIDEO PROXY --------------
app.get('/api/video/:provider/:dramaId/:episodeId', authMiddleware, async (c) => {
    const { provider, dramaId, episodeId } = c.req.param();
    const resParam = c.req.query('res');
    const langParam = c.req.query('lang');
    
    try {
        if (provider === 'flickreels') {
            const cacheKey = `flickreels:${dramaId}:${episodeId}:${resParam || 'default'}:${langParam || 'default'}`;
            const cachedUrl = await cache.get(cacheKey);
            
            if (cachedUrl) {
                const proxyUrl = `/api/proxy-media?url=${encodeURIComponent(cachedUrl)}`;
                return c.json({ source: proxyUrl, fromCache: true });
            }
            
            // Real Flickreels Hit API
            try {
                // To get the actual stream URL, we need the chapter list to map episodeId to chapterId
                const chapterData = await fetchProviderApi(provider, `chapters/${dramaId}`, { lang: langParam });
                const chapters = chapterData.data?.list || [];
                // Sort array to ensure we match the episode index (usually 1-indexed)
                // If it's already sorted, episode 1 is at index 0
                const chapter = chapters[parseInt(episodeId) - 1];
                
                if (chapter && chapter.chapter_id) {
                    const streamData = await fetchProviderApi(provider, `stream/${dramaId}/${chapter.chapter_id}`, { res: resParam, lang: langParam });
                    const realVideoUrl = streamData?.data?.hls_url || streamData?.data?.down_url;
                    
                    if (realVideoUrl) {
                        await cache.set(cacheKey, realVideoUrl, 1800); // 30 mins
                        const proxyUrl = `/api/proxy-media?url=${encodeURIComponent(realVideoUrl)}`;
                        return c.json({ source: proxyUrl, fromCache: false });
                    }
                }
            } catch (e) {
                console.error("Flickreels stream fetch error", e);
            }

            // Fallback to dummy
            const dummyVideoUrl = `/api/proxy-media?url=${encodeURIComponent(`https://mock-flickreels.com/video/${dramaId}_${episodeId}.m3u8?res=${resParam}&lang=${langParam}`)}`;
            return c.json({ source: dummyVideoUrl, fromCache: false });
        } else if (provider === 'stardust') {
            const cacheKey = `stardust:${dramaId}:${episodeId}`;
            const cachedUrl = await cache.get(cacheKey);
            
            if (cachedUrl) {
                const proxyUrl = `/api/proxy-media?url=${encodeURIComponent(cachedUrl)}`;
                return c.json({ source: proxyUrl, fromCache: true });
            }
            
            // Real Stardust Hit API
            try {
                const streamData = await fetchProviderApi('stardusttv', `video/${dramaId}/episode/${episodeId}`);
                // Use h264 as default
                const realVideoUrl = streamData?.data?.h264 || streamData?.data?.video_url;
                if (realVideoUrl) {
                    await cache.set(cacheKey, realVideoUrl); // permanent
                    const proxyUrl = `/api/proxy-media?url=${encodeURIComponent(realVideoUrl)}`;
                    return c.json({ source: proxyUrl, fromCache: false });
                }
            } catch (e) {
                console.error("Stardust stream fetch error", e);
            }

            // Fallback
            const dummyVideoUrl = `/api/proxy-media?url=${encodeURIComponent(`https://mock-stardust.com/stream/${dramaId}_${episodeId}.m3u8`)}`;
            return c.json({ source: dummyVideoUrl, fromCache: false });
        }
        
        return c.json({ error: 'Unknown provider' }, 400);
    } catch (error) {
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
        
        // If it's an m3u8 playlist, we must rewrite the URLs inside it
        if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegURL')) {
            let m3u8Content = await response.text();
            const baseUrl = new URL(targetUrl);

            // Split by lines to process URIs
            const lines = m3u8Content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                // If line is not empty and not a comment, it's a URI
                if (line && !line.startsWith('#')) {
                    try {
                        const absoluteUri = new URL(line, baseUrl).toString();
                        lines[i] = `/api/proxy-media?url=${encodeURIComponent(absoluteUri)}`;
                    } catch (e) {
                        // ignore invalid URIs
                    }
                } else if (line.startsWith('#EXT-X-STREAM-INF:') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
                    // Sometimes URIs are inside tags, but usually they are on the next line.
                    // URI= attribute handling
                    const uriMatch = line.match(/URI="([^"]+)"/);
                    if (uriMatch) {
                        try {
                            const absoluteUri = new URL(uriMatch[1], baseUrl).toString();
                            const proxyUri = `/api/proxy-media?url=${encodeURIComponent(absoluteUri)}`;
                            lines[i] = line.replace(`URI="${uriMatch[1]}"`, `URI="${proxyUri}"`);
                        } catch (e) {}
                    }
                }
            }
            
            c.header('Content-Type', 'application/vnd.apple.mpegurl');
            // Allow CORS for the frontend
            c.header('Access-Control-Allow-Origin', '*');
            return c.text(lines.join('\n'));
        }

        // For .ts or .mp4 segments, stream as binary
        c.header('Content-Type', contentType || 'application/octet-stream');
        c.header('Access-Control-Allow-Origin', '*');
        
        // Return the response body stream directly
        return new Response(response.body, {
            status: 200,
            headers: c.res.headers
        });
        
    } catch (e) {
        return c.text(`Media Proxy Error: ${e.message}`, 500);
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
        
        // Mock data for chart
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
