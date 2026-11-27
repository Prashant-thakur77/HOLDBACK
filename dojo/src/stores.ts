/**
 * Where runs live between requests.
 *
 * A store only ever holds the public state. The seed and the play token are
 * derived from a server secret (see `http.ts`), which matters for the
 * Supabase store: `dojo_runs` is readable by anyone, so nothing secret may be
 * written to it.
 */
import type { DojoState } from './types';

export interface DojoStore {
  get(runId: string): Promise<DojoState | null>;
  /**
   * Saves `state` if the stored run is still at `expectedTurn`, or creates the
   * run when `expectedTurn` is `null`. Returns `false` when another request
   * got there first, so two concurrent moves can never both be applied.
   */
  put(state: DojoState, expectedTurn: number | null): Promise<boolean>;
}

/** In-process store for tests, local play and single-instance servers. */
export function memoryStore(): DojoStore {
  // Stored as JSON so callers can never mutate a saved run through a reference.
  const runs = new Map<string, string>();
  return {
    async get(runId) {
      const saved = runs.get(runId);
      return saved === undefined ? null : (JSON.parse(saved) as DojoState);
    },
    async put(state, expectedTurn) {
      const saved = runs.get(state.run_id);
      if (expectedTurn === null) {
        if (saved !== undefined) return false;
      } else if (saved === undefined || (JSON.parse(saved) as DojoState).turn !== expectedTurn) {
        return false;
      }
      runs.set(state.run_id, JSON.stringify(state));
      return true;
    },
  };
}

/** One row of the `dojo_runs` table, limited to the columns this store writes. */
export interface DojoRunRow {
  run_id: string;
  player: string | null;
  state: DojoState;
  score: number;
  done: boolean;
  result: string | null;
  memo_signature: string | null;
}

interface SupabaseError {
  message: string;
  code?: string;
}

/**
 * The query-builder calls this store makes on `dojo_runs`. They are the
 * supabase-js calls of the same names; a test runs them through the real
 * library to keep the two in step.
 */
export interface DojoRunsTable {
  select(columns: string): {
    eq(
      column: string,
      value: string,
    ): {
      maybeSingle(): PromiseLike<{ data: unknown; error: SupabaseError | null }>;
    };
  };
  insert(row: DojoRunRow): PromiseLike<{ error: SupabaseError | null }>;
  update(row: Omit<DojoRunRow, 'run_id'>): {
    eq(
      column: string,
      value: string,
    ): {
      eq(
        column: string,
        value: string,
      ): {
        select(columns: string): PromiseLike<{ data: unknown; error: SupabaseError | null }>;
      };
    };
  };
}

/**
 * The slice of a Supabase client this store needs. A `SupabaseClient` from
 * `@supabase/supabase-js` can be passed as is, so this package does not
 * depend on the library. `from` returns `unknown` because the library's own
 * builder types are too deeply generic to compare structurally.
 */
export interface DojoSupabaseClient {
  from(table: string): unknown;
}

const TABLE = 'dojo_runs';
/** Postgres unique violation: the run id already exists. */
const UNIQUE_VIOLATION = '23505';

function toRow(state: DojoState): DojoRunRow {
  return {
    run_id: state.run_id,
    player: state.player,
    state,
    score: state.score,
    done: state.done,
    result: state.result?.outcome ?? null,
    memo_signature: state.result?.memo_signature ?? null,
  };
}

/**
 * Stores runs in Supabase. Pass a client made with the service role key: the
 * table has no insert or update policy, so only that role can write.
 */
export function supabaseStore(client: DojoSupabaseClient): DojoStore {
  const table = () => client.from(TABLE) as DojoRunsTable;
  return {
    async get(runId) {
      const { data, error } = await table().select('state').eq('run_id', runId).maybeSingle();
      if (error) throw new Error(`dojo_runs read failed: ${error.message}`);
      return (data as { state: DojoState } | null)?.state ?? null;
    },
    async put(state, expectedTurn) {
      if (expectedTurn === null) {
        const { error } = await table().insert(toRow(state));
        if (error?.code === UNIQUE_VIOLATION) return false;
        if (error) throw new Error(`dojo_runs insert failed: ${error.message}`);
        return true;
      }
      const { run_id: runId, ...changes } = toRow(state);
      // The turn filter is the compare-and-set: no row matches if the run moved on.
      const { data, error } = await table()
        .update(changes)
        .eq('run_id', runId)
        .eq('state->>turn', String(expectedTurn))
        .select('run_id');
      if (error) throw new Error(`dojo_runs update failed: ${error.message}`);
      return Array.isArray(data) && data.length > 0;
    },
  };
}
