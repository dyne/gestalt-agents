/**
 * Durable, workspace-local supervision state. This module is deliberately
 * transport-free: Codex launch profiles persist/read the record while these
 * functions enforce the protocol's ownership and recovery invariants.
 */
export const SUPERVISION_PROTOCOL_VERSION = 1;

export type SupervisionState =
  | "TODO"
  | "WIP"
  | "DONE_UNREVIEWED"
  | "REVIEW_REQUESTED"
  | "REVIEWED";

export type SupervisionOwner = "supervisor" | "director" | "executor";

export interface ReviewRequest {
  idempotencyKey: string;
  commitRange: string;
  expiresAt: string;
}

export interface SupervisionRecord {
  protocolVersion: number;
  planId: string;
  l1Id: string;
  branch: string;
  planRevision: string;
  state: SupervisionState;
  executorGeneration?: string;
  reviewRequest?: ReviewRequest;
}

export type SupervisionEvent =
  | { type: "start"; owner: "supervisor"; executorGeneration: string }
  | { type: "complete"; owner: "supervisor" }
  | { type: "request-review"; owner: "supervisor"; request: ReviewRequest }
  | { type: "accept"; owner: "supervisor"; idempotencyKey: string }
  | { type: "reject"; owner: "supervisor"; idempotencyKey: string }
  | { type: "reopen"; owner: "supervisor"; executorGeneration: string };

export type TransitionResult =
  | { ok: true; record: SupervisionRecord; idempotent: boolean }
  | { ok: false; reason: string };

function fail(reason: string): TransitionResult {
  return { ok: false, reason };
}

/** Applies only supervisor-owned transitions; a director supplies verdicts but never mutates state. */
export function transition(record: SupervisionRecord, event: SupervisionEvent): TransitionResult {
  if (record.protocolVersion !== SUPERVISION_PROTOCOL_VERSION) {
    return fail("protocol-version-mismatch");
  }
  if (event.owner !== "supervisor") return fail("state-owner-must-be-supervisor");

  if (event.type === "start") {
    if (record.state === "WIP" && record.executorGeneration === event.executorGeneration) {
      return { ok: true, record, idempotent: true };
    }
    if (record.state !== "TODO") return fail("start-requires-todo");
    return { ok: true, record: { ...record, state: "WIP", executorGeneration: event.executorGeneration }, idempotent: false };
  }
  if (event.type === "complete") {
    if (record.state === "DONE_UNREVIEWED") return { ok: true, record, idempotent: true };
    if (record.state !== "WIP") return fail("complete-requires-wip");
    return { ok: true, record: { ...record, state: "DONE_UNREVIEWED" }, idempotent: false };
  }
  if (event.type === "request-review") {
    if (record.state === "REVIEW_REQUESTED" && record.reviewRequest?.idempotencyKey === event.request.idempotencyKey) {
      return { ok: true, record, idempotent: true };
    }
    if (record.state !== "DONE_UNREVIEWED") return fail("review-request-requires-done-unreviewed");
    return { ok: true, record: { ...record, state: "REVIEW_REQUESTED", reviewRequest: event.request }, idempotent: false };
  }
  if (event.type === "accept") {
    if (record.state === "REVIEWED" && record.reviewRequest?.idempotencyKey === event.idempotencyKey) return { ok: true, record, idempotent: true };
    if (record.state !== "REVIEW_REQUESTED" || record.reviewRequest?.idempotencyKey !== event.idempotencyKey) return fail("accept-requires-current-review-request");
    return { ok: true, record: { ...record, state: "REVIEWED", executorGeneration: undefined }, idempotent: false };
  }
  if (event.type === "reject") {
    if (record.state !== "REVIEW_REQUESTED" || record.reviewRequest?.idempotencyKey !== event.idempotencyKey) return fail("reject-requires-current-review-request");
    return { ok: true, record: { ...record, state: "WIP", reviewRequest: undefined }, idempotent: false };
  }
  if (record.state !== "REVIEWED") return fail("reopen-requires-reviewed");
  return { ok: true, record: { ...record, state: "WIP", executorGeneration: event.executorGeneration, reviewRequest: undefined }, idempotent: false };
}

export type Reconciliation = "continue" | "reuse-review-request" | "terminate-stale-executor" | "fail-closed";

/** Rejects divergent branch/revision/range and identifies the only safe recovery action. */
export function reconcile(record: SupervisionRecord, expected: Pick<SupervisionRecord, "planId" | "l1Id" | "branch" | "planRevision">, now: Date): Reconciliation {
  if (record.protocolVersion !== SUPERVISION_PROTOCOL_VERSION || record.planId !== expected.planId || record.l1Id !== expected.l1Id || record.branch !== expected.branch || record.planRevision !== expected.planRevision) return "fail-closed";
  if (record.state === "WIP" && record.executorGeneration) return "terminate-stale-executor";
  if (record.state === "REVIEW_REQUESTED" && record.reviewRequest && Date.parse(record.reviewRequest.expiresAt) > now.getTime()) return "reuse-review-request";
  if (record.state === "REVIEW_REQUESTED") return "fail-closed";
  return "continue";
}
