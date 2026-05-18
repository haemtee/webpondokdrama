import { db } from './db.js';

/*
 * Analytics module.
 *
 * Two responsibilities:
 *   1. `recordEvent()` — append a row to `analytics_events` for any user
 *      action we want to count later (page view, video start, search…).
 *      Designed to never throw: analytics failures must not break the user
 *      flow.
 *   2. Aggregation helpers used by the admin dashboard. Each helper returns
 *      a small JSON-friendly payload computed via SQL aggregation.
 *
 * Schema reminder (see backend/schema.sql):
 *   analytics_events(id, user_id, event_type, provider, drama_id, episode_id,
 *                    path, metadata, ip, user_agent, created_at)
 */

// Whitelist of accepted event types. Anything else is rejected on ingest so
// the table doesn't fill up with junk from a misbehaving (or hostile) client.
const ALLOWED_EVENT_TYPES = new Set([
    'page_view',
    'login',
    'logout',
    'register',
    'subscribe',
    'cancel_subscription',
    'search',
    'content_view',     // user opened a drama detail / watch page
    'video_start',      // first time the player begins for an episode
    'video_progress',   // periodic progress ping
    'video_complete',   // user reached >=95% of the episode
    'bookmark_add',
    'bookmark_remove'
]);

/**
 * Append a single analytics row. Best-effort: on any DB error we log and
 * swallow so the caller's primary code path is unaffected.
 */
export async function recordEvent({
    userId = null,
    eventType,
    provider = null,
    dramaId = null,
    episodeId = null,
    path = null,
    metadata = null,
    ip = null,
    userAgent = null
} = {}) {
    if (!eventType || !ALLOWED_EVENT_TYPES.has(eventType)) return;
    try {
        await db.query(
            `INSERT INTO analytics_events
                (user_id, event_type, provider, drama_id, episode_id, path, metadata, ip, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId || null,
                eventType,
                provider,
                dramaId,
                episodeId,
                path,
                metadata ? JSON.stringify(metadata) : null,
                ip,
                userAgent ? String(userAgent).slice(0, 500) : null
            ]
        );
    } catch (e) {
        console.error('[analytics] recordEvent failed:', e.message);
    }
}

/**
 * Pull a useful client IP from a Hono context. Falls back to the raw socket
 * address when no proxy headers are present.
 */
export function clientIpFrom(c) {
    const xff = c.req.header('x-forwarded-for');
    if (xff) return xff.split(',')[0].trim();
    return c.req.header('x-real-ip')
        || c.env?.incoming?.socket?.remoteAddress
        || null;
}

// ---------------- aggregation helpers ----------------

/**
 * Headline KPI numbers shown at the top of the admin dashboard.
 *  - totalUsers: all-time registered users
 *  - newUsersInRange: registrations within the last `days` days
 *  - activeSubscribers: users with active subscription right now
 *  - totalViews: total `video_start` events all-time (falls back to
 *    watch_history rows if events table is empty)
 *  - viewsInRange: video_start events within the last `days` days
 *  - conversionRate: activeSubscribers / totalUsers
 *  - dau: distinct users with any event in the last 24h
 */
export async function getOverview(days = 30) {
    const [[users]] = await db.query('SELECT COUNT(*) AS total FROM users');
    const [[subs]] = await db.query(
        "SELECT COUNT(*) AS total FROM users WHERE subscription_status = 'active'"
    );
    const [[newUsers]] = await db.query(
        'SELECT COUNT(*) AS total FROM users WHERE created_at >= (NOW() - INTERVAL ? DAY)',
        [days]
    );

    // Prefer event-table numbers, fall back to watch_history if no events
    // have been ingested yet (fresh install).
    const [[viewsAll]] = await db.query(
        "SELECT COUNT(*) AS total FROM analytics_events WHERE event_type = 'video_start'"
    );
    let totalViews = viewsAll.total;
    if (!totalViews) {
        const [[wh]] = await db.query('SELECT COUNT(*) AS total FROM watch_history');
        totalViews = wh.total;
    }

    const [[viewsRange]] = await db.query(
        `SELECT COUNT(*) AS total FROM analytics_events
         WHERE event_type = 'video_start'
           AND created_at >= (NOW() - INTERVAL ? DAY)`,
        [days]
    );

    const [[dau]] = await db.query(
        `SELECT COUNT(DISTINCT user_id) AS total FROM analytics_events
         WHERE user_id IS NOT NULL
           AND created_at >= (NOW() - INTERVAL 1 DAY)`
    );

    const totalUsers = users.total || 0;
    const activeSubscribers = subs.total || 0;
    const conversionRate = totalUsers > 0
        ? Math.round((activeSubscribers / totalUsers) * 10000) / 100
        : 0;

    return {
        totalUsers,
        newUsersInRange: newUsers.total || 0,
        activeSubscribers,
        conversionRate,           // percentage, 0..100
        totalViews,
        viewsInRange: viewsRange.total || 0,
        dau: dau.total || 0,
        rangeDays: days
    };
}

/**
 * Daily series for the last `days` days. Returns three parallel arrays:
 *   labels:        ['2026-04-19', ..., '2026-05-18']
 *   registrations: [n, n, n, ...]
 *   views:         [n, n, n, ...]
 *   activeUsers:   [n, n, n, ...]   // distinct user_ids with any event
 *
 * Days with no data are filled with 0 so the chart isn't gappy.
 */
export async function getDailySeries(days = 30) {
    const [regRows] = await db.query(
        `SELECT DATE(created_at) AS d, COUNT(*) AS c
         FROM users
         WHERE created_at >= (CURDATE() - INTERVAL ? DAY)
         GROUP BY DATE(created_at)`,
        [days - 1]
    );
    const [viewRows] = await db.query(
        `SELECT DATE(created_at) AS d, COUNT(*) AS c
         FROM analytics_events
         WHERE event_type = 'video_start'
           AND created_at >= (CURDATE() - INTERVAL ? DAY)
         GROUP BY DATE(created_at)`,
        [days - 1]
    );
    const [activeRows] = await db.query(
        `SELECT DATE(created_at) AS d, COUNT(DISTINCT user_id) AS c
         FROM analytics_events
         WHERE user_id IS NOT NULL
           AND created_at >= (CURDATE() - INTERVAL ? DAY)
         GROUP BY DATE(created_at)`,
        [days - 1]
    );

    const toMap = rows => {
        const m = new Map();
        for (const r of rows) {
            const key = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10);
            m.set(key, Number(r.c) || 0);
        }
        return m;
    };
    const regs = toMap(regRows);
    const views = toMap(viewRows);
    const active = toMap(activeRows);

    const labels = [];
    const registrations = [];
    const viewsSeries = [];
    const activeUsers = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        labels.push(key);
        registrations.push(regs.get(key) || 0);
        viewsSeries.push(views.get(key) || 0);
        activeUsers.push(active.get(key) || 0);
    }
    return { labels, registrations, views: viewsSeries, activeUsers };
}

/**
 * Most popular dramas in the given window.
 * Counts `video_start` events grouped by (provider, drama_id). Falls back to
 * watch_history when the events table is empty.
 */
export async function getTopContent(days = 30, limit = 10) {
    const [rows] = await db.query(
        `SELECT provider, drama_id, COUNT(*) AS views
         FROM analytics_events
         WHERE event_type = 'video_start'
           AND drama_id IS NOT NULL
           AND created_at >= (NOW() - INTERVAL ? DAY)
         GROUP BY provider, drama_id
         ORDER BY views DESC
         LIMIT ?`,
        [days, limit]
    );
    if (rows.length) {
        return rows.map(r => ({
            provider: r.provider,
            dramaId: r.drama_id,
            views: Number(r.views) || 0
        }));
    }
    // Fallback for installs with no events recorded yet.
    const [whRows] = await db.query(
        `SELECT drama_id, COUNT(*) AS views
         FROM watch_history
         WHERE updated_at >= (NOW() - INTERVAL ? DAY)
         GROUP BY drama_id
         ORDER BY views DESC
         LIMIT ?`,
        [days, limit]
    );
    return whRows.map(r => ({
        provider: null,
        dramaId: r.drama_id,
        views: Number(r.views) || 0
    }));
}

/**
 * Subscription conversion funnel summary.
 *   total:           all users
 *   active:          users with subscription_status='active'
 *   inactive:        the rest
 *   conversionRate:  active / total (percentage)
 *   recentSubscribes: count of `subscribe`/`renew` actions in last `days`
 */
export async function getSubscriptionFunnel(days = 30) {
    const [[total]] = await db.query('SELECT COUNT(*) AS c FROM users');
    const [[active]] = await db.query(
        "SELECT COUNT(*) AS c FROM users WHERE subscription_status = 'active'"
    );
    const [[recent]] = await db.query(
        `SELECT COUNT(*) AS c FROM subscription_history
         WHERE action_type IN ('subscribe', 'renew')
           AND changed_at >= (NOW() - INTERVAL ? DAY)`,
        [days]
    ).catch(() => [[{ c: 0 }]]);

    const totalUsers = total.c || 0;
    const activeUsers = active.c || 0;
    return {
        total: totalUsers,
        active: activeUsers,
        inactive: Math.max(0, totalUsers - activeUsers),
        conversionRate: totalUsers > 0
            ? Math.round((activeUsers / totalUsers) * 10000) / 100
            : 0,
        recentSubscribes: recent.c || 0
    };
}

/**
 * Breakdown of events by type in the given window. Used to show the
 * "What are users doing?" donut chart.
 */
export async function getEventBreakdown(days = 30) {
    const [rows] = await db.query(
        `SELECT event_type, COUNT(*) AS c
         FROM analytics_events
         WHERE created_at >= (NOW() - INTERVAL ? DAY)
         GROUP BY event_type
         ORDER BY c DESC`,
        [days]
    );
    return rows.map(r => ({ eventType: r.event_type, count: Number(r.c) || 0 }));
}

/**
 * Provider popularity ranking — which upstream provider users actually
 * watch from. Helpful when deciding which adapters deserve attention.
 */
export async function getProviderBreakdown(days = 30) {
    const [rows] = await db.query(
        `SELECT provider, COUNT(*) AS c
         FROM analytics_events
         WHERE event_type = 'video_start'
           AND provider IS NOT NULL
           AND created_at >= (NOW() - INTERVAL ? DAY)
         GROUP BY provider
         ORDER BY c DESC`,
        [days]
    );
    return rows.map(r => ({ provider: r.provider, count: Number(r.c) || 0 }));
}
