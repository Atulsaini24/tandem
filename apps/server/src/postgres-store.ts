import postgres from "postgres";
import type { Store, StoredDelta, StoredSnapshot } from "./store.js";

/**
 * Postgres-backed delta log.
 *
 * Idempotency lives in the schema: UNIQUE (doc_id, client_id, client_seq) plus
 * ON CONFLICT DO NOTHING means a resent push can never be stored twice, even if the
 * server crashed between writing it and sending the ACK.
 *
 * seq is assigned as max(seq) + 1 inside the INSERT. That's correct while one server
 * process owns a document (Room serializes appends). Multiple servers (M8) need a
 * per-document lock or sequence; the PRIMARY KEY (doc_id, seq) turns a race into a
 * loud error rather than a silent duplicate.
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
    const rows = await this.#sql<Array<{ seq: string }>>`
      insert into ops (doc_id, seq, client_id, client_seq, delta)
      select ${docId}, coalesce(max(seq), 0) + 1, ${clientId}, ${clientSeq}, ${Buffer.from(delta)}
      from ops where doc_id = ${docId}
      on conflict (doc_id, client_id, client_seq) do nothing
      returning seq`;
    const row = rows[0];
    return row ? Number(row.seq) : "duplicate";
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
