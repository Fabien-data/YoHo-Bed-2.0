import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { auditLog, memberships, users } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { Env } from '../config/env';
import type { StepUpAction, StepUpDto } from './dto';

/** How long an owner's on-the-spot approval stays usable. */
const APPROVAL_TTL = '10m';

interface ApprovalClaims {
  typ: 'step_up';
  /** The approving owner. */
  sub: string;
  /** The tenant the approval is valid in. */
  tid: string;
  /** The single action it approves. */
  act: StepUpAction;
  /** The desk user who asked for it. */
  req: string;
}

export interface VerifiedApproval {
  approverId: string;
  approverEmail: string | null;
}

/**
 * Owner approval at the desk ("step-up").
 *
 * A receptionist whose discount is over the property's limit, or who wants to comp a room, asks the
 * owner to type their credentials into the same screen. The result is a short-lived token approving
 * ONE action, for ONE tenant, requested by ONE user — never a session.
 *
 * The token is signed with a key derived from the access-token secret, so it can never be replayed
 * as a bearer token, and a stolen access token can never be presented as an approval.
 */
@Injectable()
export class StepUpService {
  private readonly secret: string;

  constructor(
    private readonly dbs: DatabaseService,
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = `${config.get('JWT_SECRET', { infer: true })}:step-up`;
  }

  async approve(tenantId: string, requesterId: string, dto: StepUpDto) {
    const email = dto.email.toLowerCase();
    const [user] = await this.dbs.db.select().from(users).where(eq(users.email, email));
    // Same message for an unknown user and a wrong password.
    if (!user || !user.passwordHash || user.status !== 'active') {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const [owner] = await this.dbs.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.tenantId, tenantId)));
    if (owner?.role !== 'OWNER') {
      throw new ForbiddenException('Only an owner of this property can approve this');
    }

    const claims: ApprovalClaims = {
      typ: 'step_up',
      sub: user.id,
      tid: tenantId,
      act: dto.action,
      req: requesterId,
    };
    const approvalToken = await this.jwt.signAsync(claims, {
      secret: this.secret,
      expiresIn: APPROVAL_TTL,
    });
    const { exp } = this.jwt.decode(approvalToken) as { exp: number };

    await this.dbs.db.insert(auditLog).values({
      tenantId,
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'step_up.approved',
      entity: 'approval',
      entityId: dto.action,
      detail: { requestedBy: requesterId, reason: dto.reason ?? null },
    });

    return {
      approvalToken,
      action: dto.action,
      approver: { id: user.id, name: user.name, email: user.email },
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  /**
   * Check an approval token for exactly this tenant, action and requester. Throws 403 when it does
   * not match — an approval for a discount must never unlock a complimentary room.
   */
  async verify(
    token: string,
    expected: { tenantId: string; action: StepUpAction; requesterId: string },
  ): Promise<VerifiedApproval> {
    let claims: ApprovalClaims;
    try {
      claims = await this.jwt.verifyAsync<ApprovalClaims>(token, { secret: this.secret });
    } catch {
      throw new ForbiddenException('The owner approval has expired or is invalid');
    }
    if (
      claims.typ !== 'step_up' ||
      claims.tid !== expected.tenantId ||
      claims.act !== expected.action ||
      claims.req !== expected.requesterId
    ) {
      throw new ForbiddenException('The owner approval does not cover this action');
    }
    const [user] = await this.dbs.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, claims.sub));
    return { approverId: claims.sub, approverEmail: user?.email ?? null };
  }
}
