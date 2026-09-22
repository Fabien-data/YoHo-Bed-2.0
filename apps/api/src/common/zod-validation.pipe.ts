import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodIssue, ZodType, ZodTypeDef } from 'zod';

/** `guest.phone.number` → "Phone number"; a bare root issue has no field. */
function fieldName(path: (string | number)[]): string | null {
  const parts = path.filter((p): p is string => typeof p === 'string');
  const last = parts[parts.length - 1];
  if (!last) return null;
  const words = last
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What the desk reads when a form is refused (UX-STANDARD §5): the field and what is wrong with
 * it, never a bare "Validation failed". At most three issues, so the sentence stays readable.
 */
export function describeIssues(issues: ZodIssue[]): string {
  const sentences = issues.slice(0, 3).map((i) => {
    const field = fieldName(i.path);
    return field ? `${field}: ${i.message}` : i.message;
  });
  const more = issues.length > 3 ? ` (and ${issues.length - 3} more)` : '';
  return `${sentences.join('. ')}${more}`;
}

/**
 * Validates a request payload against a Zod schema, returning a 400 with details on failure.
 * Input is `unknown` (not `T`) so schemas with transforms — where the wire shape differs from
 * the parsed shape — still typecheck.
 *
 * The body keeps `errors` (the flattened field map, for forms that place each message on its
 * field) and gains a `message` a person can act on.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: describeIssues(result.error.issues),
        errors: result.error.flatten(),
      });
    }
    return result.data;
  }
}
