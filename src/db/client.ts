// Thin data layer over PGlite (Postgres compiled to WASM). The same SQL runs on Supabase.
// Every member-facing query runs as the Postgres role `authenticated` with the member id in
// request.jwt.claim.sub, exactly as PostgREST does on Supabase, so row-level security is real.
import { PGlite } from '@electric-sql/pglite';
import schema from '../../supabase/migrations/0001_schema.sql?raw';
import seed from '../../supabase/seed.sql?raw';

export const IDS = {
  concierge: '00000000-0000-4000-8000-000000000001',
  alex: '00000000-0000-4000-8000-000000000010',
  priya: '00000000-0000-4000-8000-000000000011',
  dana: '00000000-0000-4000-8000-000000000012',
  sofia: '00000000-0000-4000-8000-000000000013',
  mei: '00000000-0000-4000-8000-000000000014',
  hannah: '00000000-0000-4000-8000-000000000015',
  lena: '00000000-0000-4000-8000-000000000016',
  omar: '00000000-0000-4000-8000-000000000017',
  jules: '00000000-0000-4000-8000-000000000018',
  nadia: '00000000-0000-4000-8000-000000000020',
  ben: '00000000-0000-4000-8000-000000000021',
  matchAlexPriya: '00000000-0000-4000-9000-000000000001',
  matchAlexMei: '00000000-0000-4000-9000-000000000002',
} as const;

export class Db {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(readonly pg: PGlite) {}

  /** fsBundle: optional Postgres data bundle, for hosts that can't serve PGlite's default .data file. */
  static async create(opts: { fsBundle?: Blob } = {}): Promise<Db> {
    const pg = await PGlite.create(opts.fsBundle ? { fsBundle: opts.fsBundle } : {});
    await pg.exec(schema);
    await pg.exec(seed);
    return new Db(pg);
  }

  /** Run fn as a signed-in member (RLS applies). Calls are serialised so roles never leak between them. */
  as<T>(memberId: string, fn: (q: Query) => Promise<T>): Promise<T> {
    const run = async () => {
      if (!/^[0-9a-f-]{36}$/.test(memberId)) throw new Error('bad member id');
      await this.pg.exec(`set role authenticated; set request.jwt.claim.sub = '${memberId}';`);
      try {
        return await fn(new Query(this.pg));
      } finally {
        await this.pg.exec(`reset role; reset request.jwt.claim.sub;`);
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}

export class Query {
  constructor(private pg: PGlite) {}
  async rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pg.query<T>(sql, params)).rows;
  }
  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
    const r = await this.rows<T>(sql, params);
    if (!r.length) throw new Error('no rows');
    return r[0];
  }
}

/** Postgres errors from RAISE EXCEPTION come back as Error with the message we wrote. */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
