import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { payoutAccounts, tenants, users } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { PayoutAccountDto } from './dto';

/** Owner profile (Compartment H): who I am, my tenant's standing, and where to pay me. */
@Injectable()
export class ProfileService {
  constructor(private readonly dbs: DatabaseService) {}

  /** Bank details go to the owner only; everyone else sees their own details and the tenant. */
  async get(userId: string, tenantId: string, isOwner: boolean) {
    const [user] = await this.dbs.db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) throw new NotFoundException('User not found');
    const [tenant] = await this.dbs.db
      .select({
        id: tenants.id,
        name: tenants.name,
        email: tenants.email,
        status: tenants.status,
        agreementAcceptedAt: tenants.agreementAcceptedAt,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!isOwner) return { user, tenant, payoutAccount: null };
    const [payout] = await this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(payoutAccounts).where(eq(payoutAccounts.tenantId, tenantId)),
    );
    return { user, tenant, payoutAccount: payout ?? null };
  }

  /** One payout account per tenant — upsert keeps the latest details. */
  async setPayoutAccount(tenantId: string, dto: PayoutAccountDto) {
    const [row] = await this.dbs.withTenant(tenantId, (tx) =>
      tx
        .insert(payoutAccounts)
        .values({
          tenantId,
          bankName: dto.bankName,
          branchName: dto.branchName ?? null,
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
          swiftCode: dto.swiftCode ?? null,
        })
        .onConflictDoUpdate({
          target: payoutAccounts.tenantId,
          set: {
            bankName: dto.bankName,
            branchName: dto.branchName ?? null,
            accountName: dto.accountName,
            accountNumber: dto.accountNumber,
            swiftCode: dto.swiftCode ?? null,
            updatedAt: new Date(),
          },
        })
        .returning(),
    );
    return row;
  }

  /** Idempotent: first acceptance stamps the time; later calls keep the original. */
  async acceptAgreement(tenantId: string) {
    const [t] = await this.dbs.db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!t) throw new NotFoundException('Tenant not found');
    if (t.agreementAcceptedAt) return { agreementAcceptedAt: t.agreementAcceptedAt };
    const [updated] = await this.dbs.db
      .update(tenants)
      .set({ agreementAcceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning();
    return { agreementAcceptedAt: updated!.agreementAcceptedAt };
  }
}
