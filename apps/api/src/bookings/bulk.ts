/**
 * The same desk action across a selection (UX Excellence Program, UX-2): a coach party checked
 * in, a morning's departures closed, tomorrow's arrivals given rooms.
 *
 * Every stay stands or falls on its own — one guest who still owes money must not stop the other
 * eleven — so each runs in its own transaction and its refusal comes back beside the successes,
 * in the same words the single action would have used.
 */

export interface BulkOutcome {
  id: string;
  ok: boolean;
  reference?: string | null;
  /** The refusal's machine reason (`balance_open`, `room_dirty`…), for grouping the failures. */
  reason?: string;
  message?: string;
}

export interface BulkResult {
  done: number;
  failed: number;
  results: BulkOutcome[];
}

/** What a Nest exception carries: the body it will answer with. */
function detailOf(e: unknown): { reason?: string; message?: string } {
  const body = (e as { response?: unknown }).response;
  if (typeof body === 'object' && body !== null) {
    const r = body as { reason?: string; message?: string | string[] };
    const message = Array.isArray(r.message) ? r.message.join(', ') : r.message;
    return { reason: r.reason, message };
  }
  return { message: (e as Error).message };
}

export async function runBulk(
  ids: string[],
  run: (id: string) => Promise<{ reference?: string | null } | unknown>,
): Promise<BulkResult> {
  const results: BulkOutcome[] = [];
  for (const id of ids) {
    try {
      const done = (await run(id)) as { reference?: string | null } | null;
      results.push({ id, ok: true, reference: done?.reference ?? null });
    } catch (e) {
      const d = detailOf(e);
      results.push({ id, ok: false, reason: d.reason ?? 'refused', message: d.message });
    }
  }
  return {
    done: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
