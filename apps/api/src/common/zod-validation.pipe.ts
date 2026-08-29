import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Validates a request payload against a Zod schema, returning a 400 with details on failure.
 * Input is `unknown` (not `T`) so schemas with transforms — where the wire shape differs from
 * the parsed shape — still typecheck.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.flatten(),
      });
    }
    return result.data;
  }
}
