import { CmPushError, type CmAdapter, type CmPushInput, type CmPushResult } from './types';
import { AxisRoomsAdapter, type AxisRoomsConfig } from './axisrooms';

export * from './types';
export * from './axisrooms';

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
  async push(): Promise<CmPushResult> {
    throw new CmPushError(this.provider, `${this.provider} adapter not implemented yet`);
  }
}

export interface ResolveAdapterOptions extends FakeCmOptions {
  axisrooms?: AxisRoomsConfig;
}

/**
 * Selects an adapter by provider name. Dev/default = fake.
 *
 * `axisrooms` needs a baseUrl (the core service). If CM_PROVIDER=axisrooms is set without one,
 * fail loudly at startup rather than silently degrading to the fake and pretending to sync.
 *
 * The same rule applies to an unrecognised provider string: a typo like `AxisRooms ` must never
 * select the fake (which marks every outbox row `sent` while nothing reaches the channel manager),
 * so anything that is not an exact known provider throws. Case and surrounding whitespace are
 * forgiven; only `fake` — the explicit dev/demo choice — returns the fake adapter.
 */
export function resolveAdapter(provider = 'fake', opts: ResolveAdapterOptions = {}): CmAdapter {
  switch (provider.trim().toLowerCase()) {
    case 'fake':
      return new FakeCmAdapter(opts);
    case 'axisrooms': {
      if (!opts.axisrooms?.baseUrl) {
        throw new CmPushError(
          'axisrooms',
          'CM_PROVIDER=axisrooms requires CM_URL_AXISROOMS — refusing to fall back to the fake adapter',
        );
      }
      return new AxisRoomsAdapter(opts.axisrooms);
    }
    case 'rategain':
      return new NotImplementedCmAdapter('rategain');
    default:
      throw new CmPushError(
        provider,
        `Unknown CM_PROVIDER "${provider}" — expected one of fake | axisrooms | rategain. ` +
          'Refusing to fall back to the fake adapter, which would mark pushes sent without syncing anything.',
      );
  }
}
