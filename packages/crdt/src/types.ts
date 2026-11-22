/**
 * Unique identifier of one replica (one browser tab, device or server process).
 *
 * Every replica MUST have a distinct id. Timestamps are only unique because the
 * replica id is part of them, and convergence depends on unique timestamps.
 */
export type ReplicaId = string;
