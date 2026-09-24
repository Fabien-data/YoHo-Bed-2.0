# Security policy

YoHoBed stores hotel, guest and payment data, so security reports get priority.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Instead:

1. Contact the repository owner, [@Fabien-data](https://github.com/Fabien-data), directly.
2. Describe the problem, the steps to reproduce it and the impact you expect.
3. Give us reasonable time to fix it before you share it with anyone else.

We aim to acknowledge a report within 3 working days.

## How the platform protects data

- **Tenant isolation:** PostgreSQL row-level security fences every tenant table. The application
  connects as a restricted role, so a query that forgets its tenant filter still cannot read
  another hotel's rows.
- **Authentication:** signed JWTs; passwords are hashed and never stored in plain text.
- **Role checks:** sensitive actions, such as changing payout details, are limited to the owner.
- **Private files:** payment slips and ID scans are stored outside the web root and are never
  committed to git.
- **Secrets:** only `.env.example` placeholders are committed. Real secrets live on the server.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full security model.
