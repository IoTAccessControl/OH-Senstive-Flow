/** Lightweight progress logging for the CLI and server diagnostics. */

type LogCallback = (message: string) => void;

let logCallback: LogCallback | null = null;

export function setAnalysisLogCallback(callback: LogCallback | null): void {
  logCallback = callback;
}

export function analysisLog(message: string): void {
  if (process.env.ANALYZE_LOG === '0') return;
  const stamp = new Date().toISOString();
  const fullMessage = `[analysis ${stamp}] ${message}`;
  process.stderr.write(`${fullMessage}\n`);

  // Broadcast to frontend if callback is registered
  if (logCallback) {
    try {
      logCallback(message);
    } catch {
      // ignore callback errors
    }
  }
}

/**
 * Format milliseconds into a human-readable time string.
 * - < 1s: returns milliseconds (e.g., "856ms")
 * - < 1min: returns seconds (e.g., "8.5s")
 * - < 1hr: returns minutes (e.g., "12.3分")
 * - >= 1hr: returns hours (e.g., "1.5小时")
 */
export function formatElapsedTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms';

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${minutes.toFixed(1)}分`;
  }

  const hours = minutes / 60;
  return `${hours.toFixed(1)}小时`;
}