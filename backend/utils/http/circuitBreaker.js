/**
 * Minimal circuit breaker implementation.
 * No external packages required.
 *
 * States:
 *   CLOSED  → normal operation, requests pass through
 *   OPEN    → requests fail immediately with CircuitOpenError
 *   HALF-OPEN → one probe request allowed to test if service recovered
 *
 * Usage:
 *   const cb = new CircuitBreaker('zoom-api', { failureThreshold: 3, recoveryTimeout: 30_000 });
 *   const result = await cb.execute(() => somePotentiallyFailingCall());
 */
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RECOVERY_TIMEOUT = 30_000;
const DEFAULT_MAX_CONCURRENT = 1;
export class CircuitOpenError extends Error {
    serviceName;
    constructor(serviceName) {
        super(`CircuitBreaker [${serviceName}]: circuit is OPEN — request rejected`);
        this.name = 'CircuitOpenError';
        this.serviceName = serviceName;
    }
}
export class CircuitBreaker {
    name;
    failureThreshold;
    recoveryTimeout;
    maxConcurrent;
    state = 'closed';
    failures = 0;
    lastFailureTime = 0;
    ongoing = 0;
    halfOpenProbeStarted = false;
    constructor(options = {}) {
        this.name = options.name ?? 'circuit-breaker';
        this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
        this.recoveryTimeout = options.recoveryTimeout ?? DEFAULT_RECOVERY_TIMEOUT;
        this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    }
    getState() {
        this._maybeTransition();
        return this.state;
    }
    getFailures() {
        return this.failures;
    }
    /** Attempt to execute fn through the circuit breaker. Throws CircuitOpenError when open. */
    async execute(fn) {
        this._maybeTransition();
        if (this.state === 'open') {
            throw new CircuitOpenError(this.name);
        }
        if (this.state === 'half-open') {
            if (this.ongoing >= this.maxConcurrent) {
                throw new CircuitOpenError(this.name);
            }
        }
        if (this.ongoing >= this.maxConcurrent) {
            throw new CircuitOpenError(this.name);
        }
        this.ongoing++;
        let result;
        try {
            result = await fn();
            this._onSuccess();
            return result;
        }
        catch (err) {
            this._onFailure();
            throw err;
        }
        finally {
            this.ongoing--;
        }
    }
    /** Force the circuit into a given state. Useful for testing or admin resets. */
    reset(newState = 'closed') {
        this.state = newState;
        this.failures = 0;
        this.lastFailureTime = 0;
        this.halfOpenProbeStarted = false;
    }
    // ── Private helpers ────────────────────────────────────────────────────────
    _maybeTransition() {
        if (this.state === 'open' && Date.now() - this.lastFailureTime >= this.recoveryTimeout) {
            this.state = 'half-open';
            this.halfOpenProbeStarted = false;
        }
    }
    _onSuccess() {
        if (this.state === 'half-open') {
            // Recovery succeeded — close the circuit
            this.state = 'closed';
            this.failures = 0;
            this.halfOpenProbeStarted = false;
        }
        else if (this.state === 'closed') {
            // Reset failure counter on success
            this.failures = 0;
        }
    }
    _onFailure() {
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.state === 'half-open') {
            // Probe failed — go back to open
            this.state = 'open';
            this.halfOpenProbeStarted = false;
        }
        else if (this.state === 'closed' && this.failures >= this.failureThreshold) {
            this.state = 'open';
        }
    }
}
// ── Singleton instances for Zoom API calls ─────────────────────────────────────
const DEFAULT_ZOOM_OPTIONS = {
    name: 'zoom-api',
    failureThreshold: 3,
    recoveryTimeout: 30_000,
    maxConcurrent: 3,
};
/** Circuit breaker for Zoom OAuth token exchange / refresh operations */
export const zoomOAuthCircuit = new CircuitBreaker({
    ...DEFAULT_ZOOM_OPTIONS,
    name: 'zoom-oauth',
});
/** Circuit breaker for general Zoom API calls (meeting list, insights, etc.) */
export const zoomApiCircuit = new CircuitBreaker({
    ...DEFAULT_ZOOM_OPTIONS,
    name: 'zoom-api',
});
