/**
 * Observability-lite: one structured JSON line per operational event, ready
 * for log analysis and (later) Langfuse ingestion. Metadata only: message
 * content, credentials, and IPs must never reach these logs.
 */

// Intentionally broad substring match: dropping an odd operational field is
// safe, leaking user text or a key is not.
const CONTENT_LIKE_KEY = /message|content|answer|text|key|token|ip|question|prompt|query|reply|completion/i;

export function logEvent(event: Record<string, unknown> & { event: string }): void {
  try {
    const safe: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(event)) {
      if (!CONTENT_LIKE_KEY.test(name)) safe[name] = value;
    }
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...safe }));
  } catch {
    // Logging must never take a request down.
  }
}
