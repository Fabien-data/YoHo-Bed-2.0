/**
 * The restricted (`yoho_app`) connection URL for the same database `superUrl` addresses — the
 * handle these suites use to prove RLS actually bites.
 *
 * Defaults to the dev credentials `rls.sql` creates on a local docker database. On any provisioned
 * server `yoho_app` is pre-created with a real generated password *before* migrations run (see
 * `infra/provision.sh`), so the dev password is wrong there; `APP_DATABASE_URL` overrides it.
 *
 * The override MUST address the same database as `DATABASE_URL` — one connects as the owner to
 * seed fixtures, the other as the restricted role to read them back under RLS.
 */
export function appUrlFrom(superUrl: string): string {
  const override = process.env.APP_DATABASE_URL;
  if (override) return override;
  const u = new URL(superUrl);
  u.username = 'yoho_app';
  u.password = 'yoho_app_pw';
  return u.toString();
}
