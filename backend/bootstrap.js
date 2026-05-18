import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from './db.js';

/*
 * Backend bootstrap.
 *
 * Runs once on server startup. Two responsibilities:
 *   1. Apply backend/schema.sql so a fresh install (or an old DB missing the
 *      newer analytics_events table) gets the right schema. Every statement
 *      is `CREATE TABLE IF NOT EXISTS`, so this is safe to re-run.
 *   2. If the operator set ADMIN_EMAIL in the environment, promote that
 *      account to role='admin'. This avoids the "I just registered, how do I
 *      become admin?" boot-strap problem without exposing a public endpoint.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, 'schema.sql');

/**
 * Strip C-style /* ... *\/ block comments and split the schema into
 * individual statements that we can hand to mysql2 one at a time.
 *
 * mysql2's default `query()` rejects multi-statement scripts unless the
 * connection is opened with `multipleStatements: true`, which we don't want
 * to enable globally for security reasons. So we just split locally.
 */
function splitStatements(sql) {
    // Remove /* ... */ comments (DOTALL).
    const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, '');
    return stripped
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

async function applySchema() {
    let sql;
    try {
        sql = readFileSync(SCHEMA_PATH, 'utf8');
    } catch (e) {
        console.warn('[bootstrap] could not read schema.sql:', e.message);
        return;
    }

    const statements = splitStatements(sql);
    let applied = 0;
    for (const stmt of statements) {
        try {
            await db.query(stmt);
            applied++;
        } catch (e) {
            // Most likely cause: the user is on an older MySQL that doesn't
            // accept JSON, or the column already exists in a different shape.
            // We log and keep going so a single broken statement doesn't
            // block the rest of the schema from being applied.
            console.error('[bootstrap] schema statement failed:', e.message);
        }
    }
    console.log(`[bootstrap] schema applied (${applied}/${statements.length} statements)`);
}

async function ensureAdmin() {
    const email = process.env.ADMIN_EMAIL;
    if (!email) return;
    try {
        const [result] = await db.query(
            "UPDATE users SET role = 'admin' WHERE email = ? AND role <> 'admin'",
            [email]
        );
        if (result.affectedRows > 0) {
            console.log(`[bootstrap] promoted ${email} to admin`);
        } else {
            // Either the user doesn't exist yet (will be promoted on next
            // boot once they register) or they're already admin.
            const [rows] = await db.query('SELECT id, role FROM users WHERE email = ?', [email]);
            if (!rows.length) {
                console.log(`[bootstrap] ADMIN_EMAIL=${email} not found yet; will retry on next boot after they register.`);
            }
        }
    } catch (e) {
        console.error('[bootstrap] ensureAdmin failed:', e.message);
    }
}

/**
 * Run all bootstrap steps. Caller should `await` this before serving traffic
 * so the first request never sees a half-initialised DB.
 */
export async function runBootstrap() {
    await applySchema();
    await ensureAdmin();
}
