import { AuditEvent } from "../models/index.js";
import { linkedHash } from "../utils/hash.js";

// Per-loanId Promise-based mutex. Only prevents intra-process races —
// a horizontally scaled deploy would need a Mongo-backed lock; out of scope.
const chainLocks = new Map();

function acquire(loanId) {
  const prev = chainLocks.get(loanId) || Promise.resolve();
  let release;
  const next = new Promise((res) => { release = res; });
  chainLocks.set(loanId, prev.then(() => next));
  return { prev, release: () => { release(); if (chainLocks.get(loanId) === next) chainLocks.delete(loanId); } };
}

/**
 * Sequential append per loanId. Serialized via in-memory mutex so concurrent
 * requests for the same loan produce a correct chain.
 */
export async function appendAuditEvent({ loanId, type, payload, actor = null, actorRole = null }) {
  if (!loanId) throw new Error("appendAuditEvent: loanId required");
  const { prev, release } = acquire(loanId);
  await prev;
  try {
    const last = await AuditEvent.findOne({ loanId })
      .sort({ timestamp: -1, _id: -1 })
      .select({ hash: 1 })
      .lean();
    const prevHash = last ? last.hash : "GENESIS";
    const timestamp = new Date();
    const hash = linkedHash({ loanId, type, payload, actor, timestamp, prevHash });
    return await AuditEvent.create({
      loanId,
      type,
      payload,
      actor,
      actorRole,
      timestamp,
      prevHash,
      hash,
    });
  } finally {
    release();
  }
}

/**
 * Walks all events for loanId in chronological order, recomputes each hash,
 * and asserts each event.prevHash matches the previous event.hash.
 */
export async function verifyChain(loanId) {
  const events = await AuditEvent.find({ loanId })
    .sort({ timestamp: 1, _id: 1 })
    .lean();
  const total = events.length;
  if (!total) return { ok: true, brokenAtIndex: null, totalEvents: 0 };

  let expectedPrev = "GENESIS";
  for (let i = 0; i < total; i++) {
    const e = events[i];
    if (e.prevHash !== expectedPrev) return { ok: false, brokenAtIndex: i, totalEvents: total, reason: "prevHash mismatch" };
    const recomputed = linkedHash({
      loanId: e.loanId,
      type: e.type,
      payload: e.payload,
      actor: e.actor ? String(e.actor) : null,
      timestamp: e.timestamp,
      prevHash: e.prevHash,
    });
    if (recomputed !== e.hash) return { ok: false, brokenAtIndex: i, totalEvents: total, reason: "hash mismatch" };
    expectedPrev = e.hash;
  }
  return { ok: true, brokenAtIndex: null, totalEvents: total };
}

// Convenience: latest event's hash (or "GENESIS"). Used by VerifiedLoanRecord.
export async function latestAuditHash(loanId) {
  const last = await AuditEvent.findOne({ loanId })
    .sort({ timestamp: -1, _id: -1 })
    .select({ hash: 1 })
    .lean();
  return last ? last.hash : "GENESIS";
}
