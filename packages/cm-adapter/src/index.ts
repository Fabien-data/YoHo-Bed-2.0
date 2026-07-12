/**
 * @yohobed/cm-adapter — the seam between the PMS and the channel managers.
 *
 * The real OTA XML push/pull lives in external services (AxisRooms, RateGain). We black-box them
 * behind this interface so the PMS depends only on the contract, and a future in-house
 * reimplementation swaps the impl without touching the platform. `push` THROWS on failure so the
 * worker can retry and, ultimately, dead-letter — the opposite of the legacy fire-and-forget.
 */

export interface CmPushInput {
  aggregate: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
}

export interface CmPushResult {
  ok: true;
  provider: string;
  detail: string;
}

export class CmPushError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'CmPushError';
  }
}

export interface CmAdapter {
  readonly provider: string;
  push(input: CmPushInput): Promise<CmPushResult>;
}

export interface FakeCmOptions {
  latencyMs?: number;
}

/**
 * A configurable fake for dev/tests. It succeeds normally, but if an event's payload carries
 * `{ __fail: true }` it throws — letting us exercise the retry / dead-letter / alert path on
 * demand (the BUG #3 fix), without a live OTA connection.
 */
export class FakeCmAdapter implements CmAdapter {
  readonly provider = 'fake';
  constructor(private readonly opts: FakeCmOptions = {}) {}

  async push(input: CmPushInput): Promise<CmPushResult> {
    if (this.opts.latencyMs) {
      await new Promise((r) => setTimeout(r, this.opts.latencyMs));
    }
    const p = (input.payload ?? {}) as { __fail?: boolean; __failReason?: string };
    if (p.__fail) {
      throw new CmPushError('fake', p.__failReason ?? 'simulated channel-manager failure');
    }
    return {
      ok: true,
      provider: this.provider,
      detail: `pushed ${input.aggregate}:${input.aggregateId} (${input.eventType})`,
    };
  }
}

/** Placeholder real adapters — implemented against the external services in a later phase. */
export class NotImplementedCmAdapter implements CmAdapter {
  constructor(public readonly provider: string) {}
  push(): Promise<CmPushResult> {
    throw new CmPushError(this.provider, `${this.provider} adapter not implemented yet`);
  }
}

/** Selects an adapter by provider name. Dev/default = fake. */
export function resolveAdapter(provider = 'fake', opts: FakeCmOptions = {}): CmAdapter {
  switch (provider) {
    case 'axisrooms':
    case 'rategain':
      return new NotImplementedCmAdapter(provider);
    default:
      return new FakeCmAdapter(opts);
  }
}
