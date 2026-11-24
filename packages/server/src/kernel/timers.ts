// The longest wait a Node timer keeps: 2^31 − 1 ms, about 24.8 days; a longer one fires after 1 ms with a
// TimeoutOverflowWarning. Every wait the daemon takes from a caller (cell.run's and notebook.run's `timeoutMs`) or a
// setting (query.timeoutMs, bridge.rpcTimeoutMs) is clamped to it, so asking to wait longer waits that long (03-api §4.3.1); startServer's own timeouts are refused above it.
export const maxTimerMs = 2_147_483_647;

/** `ms`, at most the longest wait a timer keeps. */
export const timerMs = (ms: number): number => Math.min(ms, maxTimerMs);
