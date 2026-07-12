import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, gt } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { users, memberships, passwordResets } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { AuthPrincipal, ForgotPasswordDto, LoginDto, ResetPasswordDto } from './dto';

const RESET_TTL_MS = 60 * 60 * 1000; // 60 minutes (matches legacy password_resets expiry)

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly jwt: JwtService,
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

    const principal: AuthPrincipal = { sub: user.id, email: user.email, memberships: mems };
    const accessToken = await this.jwt.signAsync(principal);
    return {
      accessToken,
      user: { id: user.id, email: user.email, name: user.name, memberships: mems },
    };
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

    // TODO(Phase 9): send via the email provider. For now, log the link for dev.
    // eslint-disable-next-line no-console
    console.log(`[auth] password reset for ${email}: token=${token}`);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = sha256(dto.token);
    const [reset] = await this.dbs.db
      .select()
      .from(passwordResets)
      .where(and(eq(passwordResets.tokenHash, tokenHash), gt(passwordResets.expiresAt, new Date())));

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
