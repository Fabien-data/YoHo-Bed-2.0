import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, gt, inArray } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import {
  users,
  memberships,
  plans,
  subscriptions,
  passwordResets,
  tenants,
  seedDefaultTemplates,
  setTenantContext,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import type {
  AuthPrincipal,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto';

const RESET_TTL_MS = 60 * 60 * 1000; // 60 minutes (matches legacy password_resets expiry)

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const [user] = await this.dbs.db.select().from(users).where(eq(users.email, email));

    // Same error whether the user is missing or the password is wrong — no account enumeration.
    if (!user || !user.passwordHash || user.status !== 'active') {
      throw new UnauthorizedException('Invalid email or password');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const mems = await this.dbs.db
      .select({ tenantId: memberships.tenantId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.userId, user.id));

    // Tenant-status gate (Compartment H): suspended/inactive tenants cannot sign in at all.
    // 'pending' owners CAN — they set up their property while awaiting staff approval.
    const tenantIds = mems.map((m) => m.tenantId).filter((t): t is string => t !== null);
    let tenantStatuses: Array<{ tenantId: string; status: string }> = [];
    if (tenantIds.length > 0) {
      const rows = await this.dbs.db
        .select({ id: tenants.id, status: tenants.status })
        .from(tenants)
        .where(inArray(tenants.id, tenantIds));
      tenantStatuses = rows.map((r) => ({ tenantId: r.id, status: r.status }));
      const isStaff = mems.some((m) => m.tenantId === null);
      const allBlocked = rows.every((r) => r.status === 'suspended' || r.status === 'inactive');
      if (!isStaff && rows.length > 0 && allBlocked) {
        throw new ForbiddenException('This account is suspended. Contact YoHoBed support.');
      }
    }

    const principal: AuthPrincipal = { sub: user.id, email: user.email, memberships: mems };
    const accessToken = await this.jwt.signAsync(principal);
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        memberships: mems.map((m) => ({
          ...m,
          tenantStatus: tenantStatuses.find((t) => t.tenantId === m.tenantId)?.status ?? null,
        })),
      },
    };
  }

  /** Self-serve signup: pending tenant + owner user + OWNER membership, then a received-email. */
  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const [existingUser] = await this.dbs.db.select().from(users).where(eq(users.email, email));
    const [existingTenant] = await this.dbs.db
      .select()
      .from(tenants)
      .where(eq(tenants.email, email));
    if (existingUser || existingTenant) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const tenant = await this.dbs.db.transaction(async (tx) => {
      const [t] = await tx
        .insert(tenants)
        .values({ name: dto.businessName, email, status: 'pending' })
        .returning();
      const [u] = await tx
        .insert(users)
        .values({ tenantId: t!.id, email, passwordHash, name: dto.ownerName })
        .returning();
      await tx.insert(memberships).values({ userId: u!.id, tenantId: t!.id, role: 'OWNER' });
      // Without these the tenant has no templates, so guest confirmations and review invites
      // would silently never be queued. Owners can edit them later in Comms.
      // `templates` is RLS-fenced, so adopt the just-created tenant's context for this insert.
      await setTenantContext(tx, t!.id);
      await seedDefaultTemplates(tx, t!.id);

      // Every tenant needs a subscription row. Entitlements are deny-by-default, so a tenant
      // without one is entitled to nothing — a signup that lands in that state can open the app
      // and find every gated module refused. New sign-ups start on a trial of the entry plan.
      const [starter] = await tx.select().from(plans).where(eq(plans.code, 'starter'));
      if (starter) {
        await tx
          .insert(subscriptions)
          .values({ tenantId: t!.id, planId: starter.id, status: 'trialing' })
          .onConflictDoNothing();
      }
      return t!;
    });

    void this.email.send({
      to: email,
      subject: 'Welcome to YoHoBed — registration received',
      text:
        `Hi ${dto.ownerName},\n\n` +
        `Your registration for "${dto.businessName}" has been received. You can sign in now and ` +
        `start setting up your property; our team will review and activate your account shortly.\n\n` +
        `Sign in: ${this.email.webUrl}\n\n— The YoHoBed team`,
    });

    return {
      tenantId: tenant.id,
      status: tenant.status,
      message: 'Registered — awaiting approval',
    };
  }

  /** Authenticated password change (profile screen). */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const [user] = await this.dbs.db.select().from(users).where(eq(users.id, userId));
    if (!user?.passwordHash || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.dbs.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  /** Always returns success — never reveals whether an account exists. */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const email = dto.email.toLowerCase();
    const [user] = await this.dbs.db.select().from(users).where(eq(users.email, email));
    if (!user) return;

    const token = randomBytes(32).toString('hex');
    await this.dbs.db.insert(passwordResets).values({
      email,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    });

    const link = `${this.email.webUrl}/reset?token=${token}`;
    void this.email.send({
      to: email,
      subject: 'Reset your YoHoBed password',
      text: `A password reset was requested for this account.\n\nReset it here (valid 60 minutes):\n${link}\n\nIf you did not request this, ignore this email.`,
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = sha256(dto.token);
    const [reset] = await this.dbs.db
      .select()
      .from(passwordResets)
      .where(
        and(eq(passwordResets.tokenHash, tokenHash), gt(passwordResets.expiresAt, new Date())),
      );

    if (!reset) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.dbs.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.email, reset.email));

    // Invalidate all outstanding reset tokens for this email.
    await this.dbs.db.delete(passwordResets).where(eq(passwordResets.email, reset.email));
  }
}
