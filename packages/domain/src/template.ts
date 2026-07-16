/**
 * Render a `{{placeholder}}` template against a set of variables.
 *
 * Reproduces the legacy message-templating: `{{guestName}}`, `{{reference}}`, etc. are replaced
 * with their values; unknown placeholders render as empty. Whitespace inside the braces is
 * tolerated (`{{ reference }}`). Framework-free so it's shared by the API and the worker.
 */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) =>
    key in vars ? String(vars[key]) : '',
  );
}
