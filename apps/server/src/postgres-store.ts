import postgres from "postgres";
import type { AppendItem, Store, StoredDelta, StoredSnapshot } from "./store.js";

/**
 * Postgres-backed delta log.
 *
 * Idempotency lives in the schema: UNIQUE (doc_id, client_id, client_seq) plus
 * ON CONFLICT DO NOTHING means a resent push can never be stored twice, even if the
 * server crashed between writing it and sending the ACK.
 *
 * seq is assigned as max(seq) + 1 under a per-document advisory lock, so any number of
 * server instances can append to the same document. The PRIMARY KEY (doc_id, seq) is a
 * backstop: a race would be a loud error, never a silent duplicate.
 */
export class PostgresStore implements Store {
  readonly kind = "postgres";
  readonly #sql: postgres.Sql;

  private constructor(sql: postgres.Sql) {
    this.#sql = sql;
  }

  static async connect(url: string): Promise<PostgresStore> {
    const sql = postgres(url, { max: 10, onnotice: () => {} });
    await sql`
      create table if not exists ops (
        doc_id     text        not null,
        seq        bigint      not null,
        client_id  text        not null,
        client_seq bigint      not null,
        delta      bytea       not null,
        created_at timestamptz not null default now(),
        primary key (doc_id, seq),
        unique (doc_id, client_id, client_seq)
      )`;
    await sql`
      create table if not exists snapshots (
        doc_id     text        not null,
        seq        bigint      not null,
        state      bytea       not null,
        created_at timestamptz not null default now(),
        primary key (doc_id, seq)
      )`;
    return new PostgresStore(sql);
  }

  async putSnapshot(docId: string, snapshot: StoredSnapshot): Promise<void> {
    await this.#sql`
      insert into snapshots (doc_id, seq, state) values (${docId}, ${snapshot.seq}, ${Buffer.from(snapshot.state)})
      on conflict (doc_id, seq) do nothing`;
  }

  async snapshot(docId: string, atOrBefore?: number): Promise<StoredSnapshot | undefined> {
    const limit = atOrBefore ?? Number.MAX_SAFE_INTEGER;
    const rows = await this.#sql<Array<{ seq: string; state: Buffer }>>`
      select seq, state from snapshots where doc_id = ${docId} and seq <= ${limit}
      order by seq desc limit 1`;
    const row = rows[0];
    return row ? { seq: Number(row.seq), state: new Uint8Array(row.state) } : undefined;
  }

  async append(docId: string, clientId: string, clientSeq: number, delta: Uint8Array): Promise<number | "duplicate"> {
    const [result] = await this.appendBatch(docId, [{ clientId, clientSeq, delta }]);
    return result ?? "duplicate";
  }

  /**
   * Group commit: one transaction, one lock, one duplicate check, one multi-row INSERT,
   * whatever the batch size. Under load, the deltas that queued up for a document while
   * the previous transaction ran all go in the next one, so per-document throughput no
   * longer pays ~4 database round trips per delta.
   *
   * Several server instances may append to the same document at once. A transaction-
   * scoped advisory lock per document serializes them, so numbering can't race, and seq
   * N+1 can only commit after N has. Room's gap fill relies on that.
   */
  async appendBatch(docId: string, items: readonly AppendItem[]): Promise<Array<number | "duplicate">> {
    if (items.length === 0) return [];
    return this.#sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${docId}, 0))`;
      const [headRow] = await tx<Array<{ head: string }>>`
        select coalesce(max(seq), 0) as head from ops where doc_id = ${docId}`;
      // Duplicates are found BEFORE numbering: a skipped row must not leave a gap in seq.
      const existing = await tx<Array<{ client_id: string; client_seq: string }>>`
        select client_id, client_seq from ops
        where doc_id = ${docId}
          and (client_id, client_seq) in (
            select * from unnest(${tx.array(items.map((i) => i.clientId))}::text[],
                                 ${tx.array(items.map((i) => i.clientSeq))}::bigint[]))`;
      const seen = new Set(existing.map((row) => `${row.client_id}\u0000${row.client_seq}`));
      let next = Number(headRow?.head ?? 0);
      const rows: Array<{ doc_id: string; seq: number; client_id: string; client_seq: number; delta: Buffer }> = [];
      const results: Array<number | "duplicate"> = [];
      for (const item of items) {
        const key = `${item.clientId}\u0000${item.clientSeq}`;
        if (seen.has(key)) {
          results.push("duplicate"); // already stored, or twice in this very batch
          continue;
        }
        seen.add(key);
        next += 1;
        rows.push({ doc_id: docId, seq: next, client_id: item.clientId, client_seq: item.clientSeq, delta: Buffer.from(item.delta) });
        results.push(next);
      }
      if (rows.length > 0) await tx`insert into ops ${tx(rows, "doc_id", "seq", "client_id", "client_seq", "delta")}`;
      return results;
    });
  }

  async readSince(docId: string, since: number, until?: number): Promise<StoredDelta[]> {
    const upTo = until ?? Number.MAX_SAFE_INTEGER;
    const rows = await this.#sql<Array<{ seq: string; delta: Buffer }>>`
      select seq, delta from ops where doc_id = ${docId} and seq > ${since} and seq <= ${upTo} order by seq`;
    return rows.map((row) => ({ seq: Number(row.seq), delta: new Uint8Array(row.delta) }));
  }

  async head(docId: string): Promise<number> {
    const rows = await this.#sql<Array<{ head: string }>>`
      select coalesce(max(seq), 0) as head from ops where doc_id = ${docId}`;
    return Number(rows[0]?.head ?? 0);
  }

  async close(): Promise<void> {
    await this.#sql.end({ timeout: 5 });
  }
}
