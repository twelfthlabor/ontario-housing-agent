/**
 * Best-effort, in-process guardrails for the public demo.
 *
 * Limits are per server instance and reset on restart, so they are a cost
 * guardrail, not a security boundary. State for the running app lives in a
 * global singleton so hot reloads do not reset counters.
 */

export const REQUESTS_PER_MINUTE = 5;
export const REQUESTS_PER_DAY = 30;
export const LLM_CALLS_PER_DAY = 800;
export const CACHE_MAX_ENTRIES = 200;
export const CACHE_TTL_MS = 15 * 60_000;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

type Window = { startedAt: number; count: number };

export type RateDecision =
  | { allowed: true; remainingMinute: number; remainingDay: number }
  | { allowed: false; retryAfterS: number };

export type BudgetDecision = { allowed: boolean; remaining: number };

export type GuardState = {
  now: () => number;
  maxPerMinute: number;
  maxPerDay: number;
  budgetPerDay: number;
  cacheMax: number;
  cacheTtlMs: number;
  ipMinute: Map<string, Window>;
  ipDay: Map<string, Window>;
  budget: { dayKey: string; used: number };
  cache: Map<string, { answer: string; expiresAt: number }>;
};

export function createGuardState(
  options: {
    now?: () => number;
    maxPerMinute?: number;
    maxPerDay?: number;
    budgetPerDay?: number;
    cacheMax?: number;
    cacheTtlMs?: number;
  } = {},
): GuardState {
  return {
    now: options.now ?? (() => Date.now()),
    maxPerMinute: options.maxPerMinute ?? REQUESTS_PER_MINUTE,
    maxPerDay: options.maxPerDay ?? REQUESTS_PER_DAY,
    budgetPerDay: options.budgetPerDay ?? LLM_CALLS_PER_DAY,
    cacheMax: options.cacheMax ?? CACHE_MAX_ENTRIES,
    cacheTtlMs: options.cacheTtlMs ?? CACHE_TTL_MS,
    ipMinute: new Map(),
    ipDay: new Map(),
    budget: { dayKey: "", used: 0 },
    cache: new Map(),
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __housingGuardState: GuardState | undefined;
}

/** Shared state for the API route; survives hot reloads in one process. */
export function sharedGuardState(): GuardState {
  if (!globalThis.__housingGuardState) {
    globalThis.__housingGuardState = createGuardState();
  }
  return globalThis.__housingGuardState;
}

/**
 * Client IP for rate limiting: Vercel's trusted header wins, then the first
 * hop of x-forwarded-for, then "unknown". Best-effort only.
 */
export function firstHopIp(
  vercelForwardedFor: string | null | undefined,
  forwardedFor: string | null | undefined,
): string {
  const firstHop = (value: string | null | undefined): string => {
    if (!value) return "";
    return value.split(",")[0]?.trim() ?? "";
  };
  return firstHop(vercelForwardedFor) || firstHop(forwardedFor) || "unknown";
}

export function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function currentWindow(
  map: Map<string, Window>,
  key: string,
  nowMs: number,
  windowMs: number,
): Window {
  const existing = map.get(key);
  if (existing && nowMs - existing.startedAt < windowMs) return existing;
  const fresh: Window = { startedAt: nowMs, count: 0 };
  map.set(key, fresh);
  return fresh;
}

/**
 * Check and consume one request for this IP. Returns a typed decision;
 * the route maps `allowed: false` to a 429 with retry_after_s.
 */
export function takeRateLimit(
  state: GuardState,
  ip: string,
  nowMs: number = state.now(),
): RateDecision {
  const minute = currentWindow(state.ipMinute, ip, nowMs, MINUTE_MS);
  const day = currentWindow(state.ipDay, ip, nowMs, DAY_MS);

  if (minute.count >= state.maxPerMinute) {
    return {
      allowed: false,
      retryAfterS: Math.max(1, Math.ceil((minute.startedAt + MINUTE_MS - nowMs) / 1000)),
    };
  }
  if (day.count >= state.maxPerDay) {
    return {
      allowed: false,
      retryAfterS: Math.max(1, Math.ceil((day.startedAt + DAY_MS - nowMs) / 1000)),
    };
  }

  minute.count += 1;
  day.count += 1;
  return {
    allowed: true,
    remainingMinute: state.maxPerMinute - minute.count,
    remainingDay: state.maxPerDay - day.count,
  };
}

/** Peek at the global UTC-day LLM budget without consuming it. */
export function checkBudget(state: GuardState, nowMs: number = state.now()): BudgetDecision {
  const dayKey = utcDayKey(nowMs);
  if (state.budget.dayKey !== dayKey) {
    state.budget.dayKey = dayKey;
    state.budget.used = 0;
  }
  return {
    allowed: state.budget.used < state.budgetPerDay,
    remaining: Math.max(0, state.budgetPerDay - state.budget.used),
  };
}

/** Consume one LLM call from the global daily budget. */
export function consumeLlmCall(state: GuardState, nowMs: number = state.now()): BudgetDecision {
  const current = checkBudget(state, nowMs);
  if (!current.allowed) return current;
  state.budget.used += 1;
  return { allowed: true, remaining: current.remaining - 1 };
}

/** Lowercase, collapse whitespace, drop trailing punctuation. */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?!.]+$/, "")
    .trim();
}

export function getCachedAnswer(state: GuardState, question: string): string | null {
  const key = normalizeQuestion(question);
  if (!key) return null;
  const hit = state.cache.get(key);
  if (hit === undefined) return null;
  if (hit.expiresAt <= state.now()) {
    state.cache.delete(key);
    return null;
  }
  // Refresh recency for the LRU order.
  state.cache.delete(key);
  state.cache.set(key, hit);
  return hit.answer;
}

export function putCachedAnswer(state: GuardState, question: string, answer: string): void {
  const key = normalizeQuestion(question);
  const value = answer.trim();
  if (!key || !value) return;
  state.cache.delete(key);
  state.cache.set(key, { answer: value, expiresAt: state.now() + state.cacheTtlMs });
  while (state.cache.size > state.cacheMax) {
    const oldest = state.cache.keys().next().value;
    if (oldest === undefined) break;
    state.cache.delete(oldest);
  }
}
