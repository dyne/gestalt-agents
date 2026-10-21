/**
 * Measurement semantics for model-visible efficiency reporting.
 *
 * This module deliberately records only counters, identifiers, timestamps, and
 * byte sizes. It never keeps prompts, commands, or model output. The response
 * boundary supplies the actual serialization in the next measurement layer.
 */

export type MeasurementRole = "root" | "child" | "unknown";
export type UsageScope = "turn_delta" | "source_cumulative";
export type MeasurementCoverage = "complete" | "partial";

/**
 * All values are provider-reported token counts, never context occupancy or quota.
 * Input includes cached input when the provider does; cache reads/creation are
 * separately reported subsets and must not be added to input. Output includes
 * reasoning: reasoning must not be added to output. No byte conversion applies.
 * Each numeric aggregate is a known lower bound, paired with per-source coverage;
 * zero with unresolved coverage is not a measured zero. There is no denominator
 * for counts. Ratios require matching sources, cutoff, scope and full coverage.
 */
export interface TokenCounters {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** A known subset of outputTokens; zero is distinct from an unavailable value. */
  reasoningTokens: number;
}

export interface UnresolvedContribution {
  sourceId: string;
  role: MeasurementRole;
  counter: keyof TokenCounters;
  reason: "never_observed" | "missing_delta" | "historical_cumulative_gap" | "pending_cumulative";
  scope: UsageScope | null;
  epoch: number | null;
}

export interface UsageMeasurement {
  /** Idempotency key supplied by the source event or notification. */
  captureId: string;
  /** Stable source identity; child sources must not be folded into root data. */
  sourceId: string;
  role: MeasurementRole;
  scope: UsageScope;
  /** Epoch milliseconds. Missing timestamps are never included in a cutoff. */
  observedAtMs: number | null;
  counters: Partial<TokenCounters>;
}

export interface MeasurementIssue {
  captureId: string;
  sourceId: string;
  reason: "duplicate" | "missing_timestamp" | "invalid_counter" | "reasoning_exceeds_output" | "reasoning_output_unavailable" | "unknown_attribution" | "out_of_order_cumulative" | "mixed_usage_scope" | "role_changed";
}

export interface MeasurementLedger {
  /** Samples after this instant are intentionally excluded from this snapshot. */
  captureCutoffMs: number;
  /** Expected child sources make absent child coverage explicit. */
  expectedChildIds: string[];
  /** Kept as a map so a resumed/compacted process retains deduplication state. */
  seenCaptureIds: Record<string, true>;
  /** Last cumulative reading for each source. */
  cumulativeBySource: Record<string, Partial<TokenCounters>>;
  /** Latest accepted observation time per cumulative source. */
  cumulativeObservedAtBySource: Record<string, number>;
  /** Number of per-counter decreases observed after a previous cumulative reading. */
  counterResets: number;
  direct: TokenCounters;
  children: Record<string, TokenCounters>;
  /** Values whose source role could not be verified as root or child. */
  unattributed: TokenCounters;
  /** Per-source coverage prevents one complete child masking another partial child. */
  availabilityBySource: Record<string, SourceAvailability>;
  issues: MeasurementIssue[];
}

interface AvailabilityGap {
  scope: UsageScope;
  epoch: number;
}

interface SourceAvailability {
  role: MeasurementRole;
  /** One source is either a delta feed or a cumulative feed; mixing is rejected. */
  scope: UsageScope | null;
  observed: Partial<Record<keyof TokenCounters, true>>;
  /** Missing deltas and reset-separated cumulative gaps can never be repaired. */
  historicalGaps: Partial<Record<keyof TokenCounters, AvailabilityGap[]>>;
  /** A missing cumulative reading may be repaired by a later value in this epoch. */
  pendingCumulativeGaps: Partial<Record<keyof TokenCounters, AvailabilityGap>>;
  /** A reset starts a new epoch; it cannot retroactively repair prior gaps. */
  epochs: Partial<Record<keyof TokenCounters, number>>;
}

export interface EfficiencyMeasurement {
  captureCutoffMs: number;
  direct: TokenCounters;
  children: Array<{ sourceId: string; counters: TokenCounters }>;
  unattributed: TokenCounters;
  total: TokenCounters;
  counterResets: number;
  coverage: MeasurementCoverage;
  missingChildIds: string[];
  unknownDirectCounters: Array<keyof TokenCounters>;
  unknownChildCounters: Array<keyof TokenCounters>;
  unknownUnattributedCounters: Array<keyof TokenCounters>;
  unresolvedContributions: UnresolvedContribution[];
  issues: MeasurementIssue[];
  /** Provider quota is not derivable from usage events or byte counts. */
  accountQuotaTokens: null;
}

export interface ResponseByteMeasurement {
  /** UTF-8 bytes in content visible to the model before transport framing. */
  visibleResponseBytes: number;
  /** UTF-8 framing bytes added by a provided wrapper envelope. */
  wrapperEnvelopeBytes: number | null;
  /** `null` means the transport envelope was unavailable to measure. */
  transportBytes: number | null;
  transportVisibility: "measured" | "unknown";
}

const ZERO_COUNTERS: TokenCounters = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  reasoningTokens: 0,
};

const COUNTER_KEYS = Object.keys(ZERO_COUNTERS) as Array<keyof TokenCounters>;

function cloneCounters(counters: TokenCounters = ZERO_COUNTERS): TokenCounters {
  return { ...counters };
}

function addCounters(left: TokenCounters, right: TokenCounters): TokenCounters {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
  };
}

function normalizedCounters(counters: Partial<TokenCounters>): Partial<TokenCounters> | null {
  const normalized: Partial<TokenCounters> = {};
  for (const key of COUNTER_KEYS) {
    const value = counters[key];
    if (value == null) continue;
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) return null;
    normalized[key] = value;
  }
  return normalized;
}

function appendIssue(ledger: MeasurementLedger, issue: MeasurementIssue): MeasurementLedger {
  return { ...ledger, issues: [...ledger.issues, issue] };
}

function captureKey(sample: UsageMeasurement): string {
  return `${sample.sourceId}\u0000${sample.captureId}`;
}

function emptyAvailability(role: MeasurementRole): SourceAvailability {
  return { role, scope: null, observed: {}, historicalGaps: {}, pendingCumulativeGaps: {}, epochs: {} };
}

function updateAvailability(
  current: SourceAvailability,
  sample: UsageMeasurement,
  counters: Partial<TokenCounters>,
  previous: Partial<TokenCounters> | undefined,
  resetCounters: Set<keyof TokenCounters>,
): SourceAvailability {
  const observed = { ...current.observed };
  const historicalGaps = { ...current.historicalGaps };
  const pendingCumulativeGaps = { ...current.pendingCumulativeGaps };
  const epochs = { ...current.epochs };

  for (const key of COUNTER_KEYS) {
    const value = counters[key];
    if (sample.scope === "turn_delta") {
      if (value == null) {
        historicalGaps[key] = [...(historicalGaps[key] ?? []), { scope: "turn_delta", epoch: epochs[key] ?? 0 }];
      } else {
        observed[key] = true;
      }
      continue;
    }

    if (resetCounters.has(key)) {
      const pending = pendingCumulativeGaps[key];
      if (pending) {
        historicalGaps[key] = [...(historicalGaps[key] ?? []), pending];
        delete pendingCumulativeGaps[key];
      }
      epochs[key] = (epochs[key] ?? 0) + 1;
    }
    if (value == null) {
      if (previous?.[key] != null) {
        pendingCumulativeGaps[key] = { scope: "source_cumulative", epoch: epochs[key] ?? 0 };
      }
      continue;
    }

    observed[key] = true;
    const gap = pendingCumulativeGaps[key];
    if (
      gap?.scope === "source_cumulative"
      && gap.epoch === (epochs[key] ?? 0)
      && !resetCounters.has(key)
    ) {
      delete pendingCumulativeGaps[key];
    }
  }

  return {
    role: current.role,
    scope: sample.scope,
    observed,
    historicalGaps,
    pendingCumulativeGaps,
    epochs,
  };
}

function unresolvedContributions(ledger: MeasurementLedger): UnresolvedContribution[] {
  const result: UnresolvedContribution[] = [];
  for (const [sourceId, availability] of Object.entries(ledger.availabilityBySource)) {
    for (const counter of COUNTER_KEYS) {
      const historical = availability.historicalGaps[counter];
      const pending = availability.pendingCumulativeGaps[counter];
      if (historical?.length) {
        for (const gap of historical) result.push({
          sourceId,
          role: availability.role,
          counter,
          reason: gap.scope === "turn_delta" ? "missing_delta" : "historical_cumulative_gap",
          scope: gap.scope,
          epoch: gap.epoch,
        });
      }
      if (pending) {
        result.push({
          sourceId,
          role: availability.role,
          counter,
          reason: "pending_cumulative",
          scope: pending.scope,
          epoch: pending.epoch,
        });
      } else if (!historical?.length && !availability.observed[counter]) {
        result.push({ sourceId, role: availability.role, counter, reason: "never_observed", scope: null, epoch: null });
      }
    }
  }
  return result.sort((a, b) =>
    a.sourceId.localeCompare(b.sourceId) || a.counter.localeCompare(b.counter) || (a.epoch ?? -1) - (b.epoch ?? -1),
  );
}

/** Create JSON-safe ledger state that may be persisted across compaction. */
export function createMeasurementLedger(opts: {
  captureCutoffMs: number;
  expectedChildIds?: string[];
}): MeasurementLedger {
  return {
    captureCutoffMs: opts.captureCutoffMs,
    expectedChildIds: [...new Set(opts.expectedChildIds ?? [])].sort(),
    seenCaptureIds: {},
    cumulativeBySource: {},
    cumulativeObservedAtBySource: {},
    counterResets: 0,
    direct: cloneCounters(),
    children: {},
    unattributed: cloneCounters(),
    availabilityBySource: {},
    issues: [],
  };
}

/**
 * Apply one source sample. `turn_delta` samples add directly. For cumulative
 * samples, an increase contributes the difference and a decrease is treated as
 * an independent counter reset, contributing the new reading exactly once.
 * Omitted cumulative fields retain their last reading; a later value repairs
 * that epoch's gap only. A decrease with a pending gap seals the old epoch as
 * permanently partial. Resets invisible to every reported counter are unknowable.
 * Samples are consumed chronologically per cumulative source; late samples are
 * rejected with partial coverage rather than silently reordered across a cutoff.
 */
export function recordUsageMeasurement(
  ledger: MeasurementLedger,
  sample: UsageMeasurement,
): MeasurementLedger {
  const key = captureKey(sample);
  if (ledger.seenCaptureIds[key]) {
    return appendIssue(ledger, { captureId: sample.captureId, sourceId: sample.sourceId, reason: "duplicate" });
  }

  const seenCaptureIds = { ...ledger.seenCaptureIds, [key]: true as const };
  const withSeen = { ...ledger, seenCaptureIds };
  if (sample.observedAtMs == null || !Number.isFinite(sample.observedAtMs)) {
    return appendIssue(withSeen, { captureId: sample.captureId, sourceId: sample.sourceId, reason: "missing_timestamp" });
  }
  if (sample.observedAtMs > ledger.captureCutoffMs) return withSeen;

  const existingAvailability = Object.hasOwn(withSeen.availabilityBySource, sample.sourceId)
    ? withSeen.availabilityBySource[sample.sourceId] : undefined;
  if (existingAvailability && existingAvailability.role !== sample.role) {
    return appendIssue(withSeen, { captureId: sample.captureId, sourceId: sample.sourceId, reason: "role_changed" });
  }
  if (existingAvailability?.scope != null && existingAvailability.scope !== sample.scope) {
    return appendIssue(withSeen, { captureId: sample.captureId, sourceId: sample.sourceId, reason: "mixed_usage_scope" });
  }

  const normalized = normalizedCounters(sample.counters);
  if (!normalized) {
    return appendIssue(withSeen, { captureId: sample.captureId, sourceId: sample.sourceId, reason: "invalid_counter" });
  }
  if (
    normalized.reasoningTokens != null
    && normalized.outputTokens != null
    && normalized.reasoningTokens > normalized.outputTokens
  ) {
    return appendIssue(withSeen, { captureId: sample.captureId, sourceId: sample.sourceId, reason: "reasoning_exceeds_output" });
  }

  let delta: Partial<TokenCounters> = normalized;
  let cumulativeBySource = withSeen.cumulativeBySource;
  let cumulativeObservedAtBySource = withSeen.cumulativeObservedAtBySource;
  let counterResets = withSeen.counterResets;
  let previousCumulative: Partial<TokenCounters> | undefined;
  const resetCounters = new Set<keyof TokenCounters>();
  if (sample.scope === "source_cumulative") {
    const previous = Object.hasOwn(withSeen.cumulativeBySource, sample.sourceId)
      ? withSeen.cumulativeBySource[sample.sourceId] : undefined;
    previousCumulative = previous;
    const previousObservedAt = Object.hasOwn(withSeen.cumulativeObservedAtBySource, sample.sourceId)
      ? withSeen.cumulativeObservedAtBySource[sample.sourceId] : undefined;
    if (previousObservedAt != null && sample.observedAtMs < previousObservedAt) {
      return appendIssue(withSeen, { captureId: sample.captureId, sourceId: sample.sourceId, reason: "out_of_order_cumulative" });
    }
    if (previous) {
      delta = {};
      for (const key of COUNTER_KEYS) {
        const current = normalized[key];
        if (current == null) continue;
        const prior = previous[key];
        if (prior == null) {
          delta[key] = current;
        } else if (current < prior) {
          delta[key] = current;
          counterResets += 1;
          resetCounters.add(key);
        } else {
          delta[key] = current - prior;
        }
      }
    }
    cumulativeBySource = { ...withSeen.cumulativeBySource, [sample.sourceId]: { ...previous, ...normalized } };
    cumulativeObservedAtBySource = { ...withSeen.cumulativeObservedAtBySource, [sample.sourceId]: sample.observedAtMs };
  }

  const priorAvailability = existingAvailability ?? emptyAvailability(sample.role);
  const availabilityBySource = {
    ...withSeen.availabilityBySource,
    [sample.sourceId]: updateAvailability(
      priorAvailability,
      sample,
      normalized,
      previousCumulative,
      resetCounters,
    ),
  };

  const expandedDelta = { ...ZERO_COUNTERS, ...delta };
  const unverifiedReasoning = delta.reasoningTokens != null && delta.outputTokens == null;

  if (sample.role === "child") {
    const prior = Object.hasOwn(withSeen.children, sample.sourceId)
      ? withSeen.children[sample.sourceId] : cloneCounters();
    const result = {
      ...withSeen,
      cumulativeBySource,
      cumulativeObservedAtBySource,
      availabilityBySource,
      counterResets,
      children: { ...withSeen.children, [sample.sourceId]: addCounters(prior, expandedDelta) },
    };
    return unverifiedReasoning
      ? appendIssue(result, { captureId: sample.captureId, sourceId: sample.sourceId, reason: "reasoning_output_unavailable" })
      : result;
  }

  if (sample.role === "unknown") {
    const result = {
      ...withSeen,
      cumulativeBySource,
      cumulativeObservedAtBySource,
      availabilityBySource,
      counterResets,
      unattributed: addCounters(withSeen.unattributed, expandedDelta),
    };
    return appendIssue(result, { captureId: sample.captureId, sourceId: sample.sourceId, reason: "unknown_attribution" });
  }

  const result = {
    ...withSeen,
    cumulativeBySource,
    cumulativeObservedAtBySource,
    availabilityBySource,
    counterResets,
    direct: addCounters(withSeen.direct, expandedDelta),
  };
  return unverifiedReasoning
    ? appendIssue(result, { captureId: sample.captureId, sourceId: sample.sourceId, reason: "reasoning_output_unavailable" })
    : result;
}

/** Produce a snapshot with explicit coverage and no byte-to-token conversion. */
export function summarizeEfficiencyMeasurement(ledger: MeasurementLedger): EfficiencyMeasurement {
  const children = Object.entries(ledger.children)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sourceId, counters]) => ({ sourceId, counters: cloneCounters(counters) }));
  const total = children.reduce((sum, child) => addCounters(sum, child.counters), cloneCounters(ledger.direct));
  const missingChildIds = ledger.expectedChildIds.filter((id) => !Object.hasOwn(ledger.children, id));
  const unresolved = unresolvedContributions(ledger);
  const countersForRole = (role: MeasurementRole): Array<keyof TokenCounters> =>
    [...new Set(unresolved.filter((item) => item.role === role).map((item) => item.counter))]
      .sort((a, b) => a.localeCompare(b)) as Array<keyof TokenCounters>;
  const hasRoot = Object.values(ledger.availabilityBySource).some(({ role }) => role === "root");
  const unknownDirectCounters = hasRoot ? countersForRole("root") : [...COUNTER_KEYS].sort();
  const unknownChildCounters = countersForRole("child");
  const unknownUnattributedCounters = countersForRole("unknown");
  const coverage = missingChildIds.length > 0 || ledger.issues.some((issue) =>
    issue.reason !== "duplicate",
  ) || unresolved.length > 0 || !hasRoot ? "partial" : "complete";

  return {
    captureCutoffMs: ledger.captureCutoffMs,
    direct: cloneCounters(ledger.direct),
    children,
    unattributed: cloneCounters(ledger.unattributed),
    total,
    counterResets: ledger.counterResets,
    coverage,
    missingChildIds,
    unknownDirectCounters,
    unknownChildCounters,
    unknownUnattributedCounters,
    unresolvedContributions: unresolved,
    issues: [...ledger.issues],
    accountQuotaTokens: null,
  };
}

/**
 * Measure UTF-8 content and optional transport framing without guessing that
 * bytes equal tokens or that every transport wrapper reaches the model.
 */
export function measureResponseBytes(
  visibleContent: string,
  serializedEnvelope?: string,
): ResponseByteMeasurement {
  const visibleResponseBytes = Buffer.byteLength(visibleContent, "utf8");
  if (serializedEnvelope == null) {
    return {
      visibleResponseBytes,
      wrapperEnvelopeBytes: null,
      transportBytes: null,
      transportVisibility: "unknown",
    };
  }
  const transportBytes = Buffer.byteLength(serializedEnvelope, "utf8");
  return {
    visibleResponseBytes,
    wrapperEnvelopeBytes: Math.max(0, transportBytes - visibleResponseBytes),
    transportBytes,
    transportVisibility: "measured",
  };
}
