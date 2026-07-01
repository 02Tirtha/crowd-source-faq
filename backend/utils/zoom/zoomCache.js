/**
 * zoomCache.ts
 *
 * In-memory TTL cache for Zoom API responses.
 * Prevents hammering Zoom API when it's slow or rate-limited.
 *
 * Cache keys: `meetings:${userId}:${page}` | `insights:${meetingId}` | `meeting:${id}`
 * TTL: 60s for list data (stale-while-revalidate), 5min for single items.
 */
export class ZoomCache {
    store = new Map();
    stats = { hits: 0, misses: 0, staleHits: 0, evicted: 0 };
    maxEntries = 200;
    // TTLs in ms
    static LIST_TTL = 60_000; // 60s — meetings list
    static ITEM_TTL = 5 * 60_000; // 5min — single meeting / insights
    static STALE_WINDOW = 30_000; // serve stale for 30s after expiry
    // ── Public API ───────────────────────────────────────────────────────────────
    get(key) {
        const entry = this.store.get(key);
        if (!entry) {
            this.stats.misses++;
            return null;
        }
        const now = Date.now();
        if (now < entry.expiresAt) {
            this.stats.hits++;
            return { data: entry.data, isStale: false };
        }
        if (now < entry.staleAt) {
            this.stats.staleHits++;
            return { data: entry.data, isStale: true };
        }
        // Expired past stale window
        this.store.delete(key);
        this.stats.evicted++;
        this.stats.misses++;
        return null;
    }
    set(key, data, ttlMs) {
        if (this.store.size >= this.maxEntries && !this.store.has(key)) {
            // evict oldest entry
            const oldest = [...this.store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
            this.store.delete(oldest[0]);
            this.stats.evicted++;
        }
        const now = Date.now();
        this.store.set(key, {
            data,
            expiresAt: now + ttlMs,
            staleAt: now + ttlMs + ZoomCache.STALE_WINDOW,
        });
    }
    invalidate(pattern) {
        let count = 0;
        for (const key of this.store.keys()) {
            if (key.includes(pattern)) {
                this.store.delete(key);
                count++;
            }
        }
        this.stats.evicted += count;
        return count;
    }
    getStats() {
        return { ...this.stats };
    }
    resetStats() {
        this.stats = { hits: 0, misses: 0, staleHits: 0, evicted: 0 };
    }
    // ── Convenience typed getters ───────────────────────────────────────────────
    meetingsKey(userId, page = 1) {
        return `meetings:${userId}:${page}`;
    }
    insightsKey(meetingId) {
        return `insights:${meetingId}`;
    }
    meetingKey(id) {
        return `meeting:${id}`;
    }
    userStatusKey(userId) {
        return `zoom:status:${userId}`;
    }
    getMeetings(key) {
        const hit = this.get(key);
        return hit ? hit.data : null;
    }
    setMeetings(key, data) {
        this.set(key, data, ZoomCache.LIST_TTL);
    }
    getInsights(key) {
        const hit = this.get(key);
        return hit ? hit.data : null;
    }
    setInsights(key, data) {
        this.set(key, data, ZoomCache.ITEM_TTL);
    }
    getMeeting(key) {
        const hit = this.get(key);
        return hit ? hit.data : null;
    }
    setMeeting(key, data) {
        this.set(key, data, ZoomCache.ITEM_TTL);
    }
}
// Singleton — shared across all Zoom API calls
export const zoomCache = new ZoomCache();
