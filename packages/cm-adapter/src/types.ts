/**
 * The seam between the PMS and the channel managers.
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
