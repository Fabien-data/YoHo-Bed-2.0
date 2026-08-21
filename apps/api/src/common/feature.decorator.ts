import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '@yohobed/domain';

export const FEATURE_KEY = 'feature';

/**
 * Gate a route/controller behind a subscription feature (via EntitlementGuard).
 *
 * This is deliberately separate from `@Roles()`: a role answers "who are you", a feature answers
 * "what did your tenant buy". An OWNER on the Starter plan is fully authorized *and* not entitled.
 */
export const Feature = (...features: FeatureKey[]) => SetMetadata(FEATURE_KEY, features);
