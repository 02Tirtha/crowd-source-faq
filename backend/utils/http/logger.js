/**
 * logger.ts — Centralized application logger with named instances
 * + Discord webhook forwarder.
 *
 * v1.67 — Adds a typed "named logger" API so each subsystem gets
 * its own prefix (`[auth]`, `[admin]`, `[db]`, `[cron]`, etc.)
 * without sprinkling bracket tags in the call sites. The base
 * `logger` still exists for one-off use.
 *
 * Usage:
 *   import { createLogger } from '../utils/http/logger.js';
 *   const log = createLogger('auth');
 *   log.info('login ok', { userId });
 *   // → [14:23:01.234] [INFO ] [auth] login ok {"userId":"..."}
 *
 * Level hierarchy (most-severe first):
 *   alert  → red+bold,   [ALERT]  → forwards to Discord
 *   error  → red,        [ERROR]  → stderr
 *   warn   → yellow,     [WARN ]  → stdout
 *   info   → blue,       [INFO ]  → stdout
 *
 * Discord setup:
 *   1. Discord channel → Settings → Integrations → Webhooks
 *   2. Create a webhook, copy the URL
 *   3. backend/.env: DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
 *   4. Restart. Missing/empty env → ALERTs still log to console,
 *      just no Discord ping.
 */
const LOG_LEVELS = {
    info: 'INFO', // 4 chars
    warn: 'WARN', // 4 chars
    error: 'ERR ', // 4 chars (trailing space for alignment)
    alert: 'ALRT', // 4 chars (abbreviated so the [TAG] is 4 wide)
};
/**
 * v1.68 — Center a short string inside a fixed-width `[  TAG  ]`
 * box. 6-char inner = 8-char outer. Used for both the level tag
 * and the category tag so the columns line up.
 */
function centerInBox(text, innerWidth = 6) {
    if (text.length >= innerWidth)
        return `[${text}]`;
    const totalPad = innerWidth - text.length;
    const left = Math.floor(totalPad / 2);
    const right = totalPad - left;
    return `[${' '.repeat(left)}${text}${' '.repeat(right)}]`;
}
const C = {
    reset: (s) => `\x1b[0m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    blue: (s) => `\x1b[34m${s}\x1b[0m`,
    magenta: (s) => `\x1b[35m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    white: (s) => `\x1b[37m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    // Background-colored tags — the level stays on a single line,
    // the tag stands out from the rest of the line.
    bgBlue: (s) => `\x1b[44;97m${s}\x1b[0m`, // INFO  — blue bg, white text
    bgYellow: (s) => `\x1b[43;30m${s}\x1b[0m`, // WARN  — yellow bg, black text
    bgRed: (s) => `\x1b[41;97m${s}\x1b[0m`, // ERROR — red bg, white text
    // ALERT uses inverse + bold (red text on white bg) — the
    // most attention-grabbing tag in the system.
    bgAlert: (s) => `\x1b[1;37;41m${s}\x1b[0m`, // ALERT — bold white on red bg
    boldRed: (s) => `\x1b[1;31m${s}\x1b[0m`,
};
/**
 * Leading symbol per level. One char so the line stays
 * one-line. Pairs with the level tag for redundancy — the
 * symbol gives at-a-glance severity without parsing the tag.
 */
const LEVEL_GLYPHS = {
    info: '▶',
    warn: '!',
    error: '✗',
    alert: '‼',
};
const LEVEL_GLYPH_COLORS = {
    info: C.cyan,
    warn: C.yellow,
    error: C.red,
    alert: C.boldRed,
};
// v1.68 — L1 sweep: subsystem-specific loggers for the
// remaining user-facing domains.
const CATEGORY_COLORS = {
    auth: C.cyan,
    admin: C.magenta,
    db: C.blue,
    cron: C.green,
    queue: C.yellow,
    http: C.dim,
    shutdown: C.boldRed,
    startup: C.bold,
    security: C.boldRed,
    audit: C.boldRed,
    community: C.green,
    support: C.yellow,
};
function coloredCategory(text, rawCategory) {
    const fn = CATEGORY_COLORS[rawCategory] ?? C.dim;
    return fn(centerInBox(text));
}
function coloredLevel(level) {
    const label = centerInBox(LOG_LEVELS[level]); // 8 chars wide incl brackets
    if (level === 'alert')
        return C.bgAlert(label);
    if (level === 'error')
        return C.bgRed(label);
    if (level === 'warn')
        return C.bgYellow(label);
    return C.bgBlue(label); // info
}
function formatLog(entry) {
    const timestamp = new Date().toISOString().slice(11, 23);
    const lvl = coloredLevel(entry.level);
    const glyph = LEVEL_GLYPH_COLORS[entry.level](LEVEL_GLYPHS[entry.level]);
    // Category: truncate to 6 inner chars + '…' if longer, then
    // center. Keeps the column width consistent so the log
    // looks like a table.
    const rawCat = entry.category;
    const catText = rawCat.length > 6 ? rawCat.slice(0, 5) + '…' : rawCat;
    const cat = coloredCategory(catText, rawCat);
    const metaKeys = Object.keys(entry.meta || {});
    const metaStr = metaKeys.length > 0 ? ` ${C.dim(JSON.stringify(entry.meta))}` : '';
    // For ALERT, add separators above + below so it stands out
    // in scrollback. Otherwise the line is one-line + compact.
    const prefix = entry.level === 'alert' ? C.boldRed('━'.repeat(80)) + '\n' + C.boldRed('  ') : '';
    const suffix = entry.level === 'alert' ? '\n' + C.boldRed('━'.repeat(80)) : '';
    return `${prefix}${C.dim(timestamp)} ${glyph} ${lvl} ${cat} ${C.bold(entry.message)}${metaStr}${suffix}`;
}
function emit(entry) {
    const formatted = formatLog(entry);
    if (entry.level === 'error' || entry.level === 'alert') {
        console.error(formatted);
    }
    else {
        console.log(formatted);
    }
    // Forward alerts to Discord (best-effort, fire-and-forget).
    if (entry.level === 'alert') {
        notifyDiscord(entry.message, entry.meta, entry.category).catch(() => { });
    }
}
/**
 * Create a named logger. Each subsystem should have ONE and
 * import it at the top of its files. The `category` is the
 * bracketed prefix you see in the log line.
 *
 *   const log = createLogger('auth');
 *   log.alert('banned login attempt', { email, ip });
 */
export function createLogger(category) {
    const make = (requestId) => {
        const o = {
            info: (message, meta) => emit({ level: 'info', category, message, meta, requestId }),
            warn: (message, meta) => emit({ level: 'warn', category, message, meta, requestId }),
            error: (message, meta) => emit({ level: 'error', category, message, meta, requestId }),
            alert: (message, meta) => emit({ level: 'alert', category, message, meta, requestId }),
            audit: (action, meta) => emit({
                level: 'alert',
                category,
                message: `[AUDIT] ${action}`,
                meta: { action, timestamp: new Date().toISOString(), ...meta },
                requestId,
            }),
            child: (rid) => make(rid),
        };
        return o;
    };
    return make();
}
// ─── Pre-built loggers for the major subsystems ─────────────────────────────
export const authLog = createLogger('auth');
export const adminLog = createLogger('admin');
export const dbLog = createLogger('db');
export const cronLog = createLogger('cron');
export const queueLog = createLogger('queue');
export const httpLog = createLogger('http');
export const startupLog = createLogger('startup');
export const shutdownLog = createLogger('shutdown');
export const securityLog = createLogger('security');
// v1.68 — L1 sweep: subsystem-specific loggers for the remaining
// user-facing domains. communityLog covers post + comment +
// public FAQ reads. supportLog covers the user-facing support
// ticket + golden-ticket flow. queueLog (already present)
// covers the BullMQ job worker.
export const communityLog = createLogger('community');
export const supportLog = createLogger('support');
function logWithRequestId(requestId, input) {
    emit({ ...input, category: input.category ?? '-', requestId });
}
const log = (input, requestId) => {
    logWithRequestId(requestId || '-', input);
};
export const logger = {
    info: (message, meta, requestId) => logWithRequestId(requestId || '-', { level: 'info', message, meta }),
    warn: (message, meta, requestId) => logWithRequestId(requestId || '-', { level: 'warn', message, meta }),
    error: (message, meta, requestId) => logWithRequestId(requestId || '-', { level: 'error', message, meta }),
    /**
     * v1.67 — ALERT level. Red+bold, [ALERT] tag, forwarded to Discord
     * when DISCORD_WEBHOOK_URL is set. Use for security-relevant events:
     * server start/stop, DB disconnect, banned login attempts, admin
     * resolve/reject/ban, etc.
     */
    alert: (message, meta, requestId) => logWithRequestId(requestId || '-', { level: 'alert', message, meta }),
    /**
     * Audit log for security-sensitive admin actions. Always at ALERT
     * level so it stands out AND forwards to Discord.
     */
    audit: (action, meta) => logWithRequestId('-', {
        level: 'alert',
        message: `[AUDIT] ${action}`,
        meta: { action, timestamp: new Date().toISOString(), ...meta },
    }),
    notifyDiscord,
};
let webhookUrl = null;
let webhookConfigured = false;
function getWebhookUrl() {
    if (webhookConfigured)
        return webhookUrl;
    webhookUrl = (process.env.DISCORD_WEBHOOK_URL ?? '').trim() || null;
    webhookConfigured = true;
    return webhookUrl;
}
const discordQueue = [];
const DISCORD_QUEUE_MAX = 50;
const DISCORD_RETRY_BASE_MS = 2_000; // first retry after 2s
const DISCORD_RETRY_MAX_MS = 5 * 60_000; // cap at 5 minutes
let discordRetryTimer = null;
function scheduleDiscordRetry() {
    if (discordRetryTimer)
        return;
    const next = discordQueue[0]?.nextAttemptAt ?? Date.now() + DISCORD_RETRY_BASE_MS;
    const delay = Math.max(0, next - Date.now());
    discordRetryTimer = setTimeout(() => {
        discordRetryTimer = null;
        void drainDiscordQueue();
    }, delay);
}
async function drainDiscordQueue() {
    if (discordQueue.length === 0)
        return;
    const now = Date.now();
    // Take the first item whose nextAttemptAt has passed
    const idx = discordQueue.findIndex(q => q.nextAttemptAt <= now);
    if (idx === -1) {
        scheduleDiscordRetry();
        return;
    }
    const item = discordQueue.splice(idx, 1)[0];
    const url = getWebhookUrl();
    if (!url) {
        // Webhook got removed while we were buffering. Drop the
        // queue silently — no way to deliver.
        discordQueue.length = 0;
        return;
    }
    const ok = await postDiscordEmbed(url, `[ALERT] ${item.message}`, item.meta, item.category);
    if (!ok) {
        // Re-queue with exponential backoff, but cap queue size.
        item.attempts += 1;
        const backoff = Math.min(DISCORD_RETRY_BASE_MS * 2 ** item.attempts, DISCORD_RETRY_MAX_MS);
        item.nextAttemptAt = Date.now() + backoff;
        if (discordQueue.length < DISCORD_QUEUE_MAX) {
            discordQueue.push(item);
        }
        // If queue is full, the oldest is implicitly dropped (FIFO
        // eviction would be nicer but we cap at 50 to bound memory).
    }
    // Continue draining
    if (discordQueue.length > 0)
        scheduleDiscordRetry();
}
async function postDiscordEmbed(url, title, meta, category) {
    const fields = [];
    if (category)
        fields.push({ name: 'category', value: category, inline: true });
    if (meta && typeof meta === 'object') {
        for (const [k, v] of Object.entries(meta)) {
            const str = typeof v === 'string' ? v : JSON.stringify(v);
            fields.push({ name: k, value: str.length > 1024 ? str.slice(0, 1000) + '…' : str, inline: false });
        }
    }
    const payload = {
        username: 'Yaksha Logger',
        embeds: [{
                title: title.slice(0, 240),
                color: DISCORD_COLORS.alert,
                fields,
                timestamp: new Date().toISOString(),
                footer: { text: 'Yaksha FAQ Portal' },
            }],
    };
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        return res.ok;
    }
    catch {
        return false;
    }
    finally {
        clearTimeout(t);
    }
}
const DISCORD_COLORS = {
    alert: 0xCC2222,
    error: 0xE67E22,
    warn: 0xF1C40F,
    info: 0x3498DB,
};
async function notifyDiscord(message, meta, category) {
    const url = getWebhookUrl();
    if (!url)
        return;
    const ok = await postDiscordEmbed(url, `[ALERT] ${message}`, meta, category);
    if (!ok) {
        // Enqueue for retry. Cap at DISCORD_QUEUE_MAX to bound memory.
        if (discordQueue.length >= DISCORD_QUEUE_MAX) {
            // Drop the oldest to make room
            discordQueue.shift();
        }
        discordQueue.push({
            message,
            meta,
            category,
            attempts: 0,
            nextAttemptAt: Date.now() + DISCORD_RETRY_BASE_MS,
        });
        scheduleDiscordRetry();
    }
}
export default log;
