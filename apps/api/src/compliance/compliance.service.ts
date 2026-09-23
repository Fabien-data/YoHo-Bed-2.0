import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import {
  bookings,
  customers,
  guestDocuments,
  properties,
  stayRegistrations,
  type Tx,
} from '@yohobed/db';
import {
  formCDueAt,
  formCRequired,
  registrationMissing,
  resolvePropertySettings,
  type RegistrationFacts,
} from '@yohobed/domain';
import { DatabaseService } from '../database/database.service';
import type { FormCSubmitDto, RegistrationDto } from './dto';

type Booking = typeof bookings.$inferSelect;

/** How far back the Form C tracker looks: a filing is never more than a few days late. */
const TRACKER_DAYS = 14;

/**
 * What the register knows about a stay: the guest's profile, their primary identity document and
 * the stay's journey. Read by the check-in guard and the registration screen alike.
 */
export async function registrationFacts(tx: Tx, b: Booking): Promise<RegistrationFacts> {
  const [c] = await tx.select().from(customers).where(eq(customers.id, b.customerId));
  const [doc] = await tx
    .select()
    .from(guestDocuments)
    .where(eq(guestDocuments.customerId, b.customerId))
    .orderBy(desc(guestDocuments.isPrimary), desc(guestDocuments.createdAt))
    .limit(1);
  const [reg] = await tx
    .select({ arrivedFrom: stayRegistrations.arrivedFrom })
    .from(stayRegistrations)
    .where(eq(stayRegistrations.bookingId, b.id));
  return {
    name: c?.name,
    address: c?.address,
    occupation: c?.occupation,
    gender: c?.gender,
    nationalityCode: c?.nationalityCode,
    documentNumber: doc?.number,
    documentPlaceOfIssue: doc?.placeOfIssue,
    documentIssuedOn: doc?.issuedOn,
    arrivedFrom: reg?.arrivedFrom,
  };
}

/**
 * The stay's registration with the authorities (Development Phase 02, Sprint 7): India's Form C
 * tracker and Malaysia's guest register. Every plan: this is the law, not a feature.
 */
@Injectable()
export class ComplianceService {
  constructor(private readonly dbs: DatabaseService) {}

  registration(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, (tx) => this.registrationWithin(tx, bookingId));
  }

  saveRegistration(tenantId: string, bookingId: string, dto: RegistrationDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const b = await this.booking(tx, bookingId);
      const values = {
        ...(dto.arrivedFrom !== undefined && { arrivedFrom: dto.arrivedFrom?.trim() || null }),
        ...(dto.arrivedInCountryOn !== undefined && {
          arrivedInCountryOn: dto.arrivedInCountryOn || null,
        }),
        ...(dto.portOfEntry !== undefined && { portOfEntry: dto.portOfEntry?.trim() || null }),
        ...(dto.nextDestination !== undefined && {
          nextDestination: dto.nextDestination?.trim() || null,
        }),
        ...(dto.purposeOfVisit !== undefined && {
          purposeOfVisit: dto.purposeOfVisit?.trim() || null,
        }),
      };
      await tx
        .insert(stayRegistrations)
        .values({ tenantId, bookingId: b.id, ...values })
        .onConflictDoUpdate({
          target: stayRegistrations.bookingId,
          set: { ...values, updatedAt: new Date() },
        });
      return this.registrationWithin(tx, bookingId);
    });
  }

  /** Record that Form C was filed on the Bureau of Immigration portal, with its reference. */
  submitFormC(tenantId: string, bookingId: string, dto: FormCSubmitDto, userId: string | null) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const b = await this.booking(tx, bookingId);
      const p = await this.property(tx, b.propertyId);
      const [c] = await tx
        .select({ nationalityCode: customers.nationalityCode })
        .from(customers)
        .where(eq(customers.id, b.customerId));
      if (!formCRequired(p.countryCode, c?.nationalityCode, b.residency)) {
        throw new BadRequestException({
          reason: 'form_c_not_required',
          message: 'This stay does not need Form C: the guest is not a foreign national.',
        });
      }
      const values = {
        formCStatus: 'submitted',
        formCReference: dto.reference.trim(),
        formCSubmittedAt: dto.submittedAt ? new Date(dto.submittedAt) : new Date(),
        formCSubmittedByUserId: userId,
      };
      await tx
        .insert(stayRegistrations)
        .values({ tenantId, bookingId: b.id, ...values })
        .onConflictDoUpdate({
          target: stayRegistrations.bookingId,
          set: { ...values, updatedAt: new Date() },
        });
      return this.registrationWithin(tx, bookingId);
    });
  }

  /**
   * India's Form C work list: every foreign guest who arrived in the last fortnight, the hour
   * their filing is due, and whether it is done. Overdue first, then the soonest due.
   */
  formCTracker(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const p = await this.property(tx, propertyId);
      if (p.countryCode !== 'IN') return { required: false, rows: [] };
      const since = new Date(Date.now() - TRACKER_DAYS * 86_400_000);
      const rows = await tx
        .select({
          bookingId: bookings.id,
          reference: bookings.reference,
          status: bookings.status,
          residency: bookings.residency,
          checkin: bookings.checkin,
          checkout: bookings.checkout,
          checkedInAt: bookings.checkedInAt,
          guestName: customers.name,
          nationalityCode: customers.nationalityCode,
          formCStatus: stayRegistrations.formCStatus,
          formCReference: stayRegistrations.formCReference,
          formCSubmittedAt: stayRegistrations.formCSubmittedAt,
        })
        .from(bookings)
        .innerJoin(customers, eq(customers.id, bookings.customerId))
        .leftJoin(stayRegistrations, eq(stayRegistrations.bookingId, bookings.id))
        .where(
          and(
            eq(bookings.propertyId, propertyId),
            inArray(bookings.status, ['CheckedIn', 'CheckedOut']),
            gte(bookings.checkedInAt, since),
          ),
        );
      const now = Date.now();
      const out = rows
        .filter(
          (r) => r.checkedInAt && formCRequired(p.countryCode, r.nationalityCode, r.residency),
        )
        .map((r) => {
          const due = formCDueAt(r.checkedInAt!);
          const submitted = r.formCStatus === 'submitted';
          return {
            bookingId: r.bookingId,
            reference: r.reference,
            guestName: r.guestName,
            nationalityCode: r.nationalityCode,
            status: r.status,
            checkin: r.checkin,
            checkout: r.checkout,
            checkedInAt: r.checkedInAt,
            dueAt: due,
            submitted,
            overdue: !submitted && due.getTime() < now,
            hoursLeft: submitted ? null : Math.round((due.getTime() - now) / 360_000) / 10,
            formCReference: r.formCReference,
            submittedAt: r.formCSubmittedAt,
          };
        })
        .sort(
          (a, b) =>
            Number(a.submitted) - Number(b.submitted) || a.dueAt.getTime() - b.dueAt.getTime(),
        );
      return {
        required: true,
        pending: out.filter((r) => !r.submitted).length,
        overdue: out.filter((r) => r.overdue).length,
        rows: out,
      };
    });
  }

  private async registrationWithin(tx: Tx, bookingId: string) {
    const b = await this.booking(tx, bookingId);
    const p = await this.property(tx, b.propertyId);
    const [reg] = await tx
      .select()
      .from(stayRegistrations)
      .where(eq(stayRegistrations.bookingId, b.id));
    const facts = await registrationFacts(tx, b);
    const settings = resolvePropertySettings(p.settings);
    const formC = formCRequired(p.countryCode, facts.nationalityCode, b.residency);
    return {
      bookingId: b.id,
      arrivedFrom: reg?.arrivedFrom ?? null,
      arrivedInCountryOn: reg?.arrivedInCountryOn ?? null,
      portOfEntry: reg?.portOfEntry ?? null,
      nextDestination: reg?.nextDestination ?? null,
      purposeOfVisit: reg?.purposeOfVisit ?? null,
      formC: {
        required: formC,
        status: formC
          ? reg?.formCStatus === 'submitted'
            ? 'submitted'
            : 'pending'
          : 'not_required',
        reference: reg?.formCReference ?? null,
        submittedAt: reg?.formCSubmittedAt ?? null,
        dueAt: formC && b.checkedInAt ? formCDueAt(b.checkedInAt) : null,
      },
      guestRegister: {
        required: settings.requireGuestRegistration,
        missing: settings.requireGuestRegistration ? registrationMissing(facts) : [],
      },
    };
  }

  private async booking(tx: Tx, id: string) {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, id));
    if (!b) throw new NotFoundException('Booking not found');
    return b;
  }

  private async property(tx: Tx, id: string) {
    const [p] = await tx.select().from(properties).where(eq(properties.id, id));
    if (!p) throw new NotFoundException('Property not found');
    return p;
  }
}

/** The check-in guard for Malaysia's register (used by BookingService). */
export async function assertRegistered(tx: Tx, b: Booking, reference: string) {
  const missing = registrationMissing(await registrationFacts(tx, b));
  if (missing.length) {
    throw new ConflictException({
      reason: 'registration_required',
      missing,
      message: `This hotel keeps the guest register before check-in. Still needed for ${reference}: ${missing.join(', ')}.`,
    });
  }
}
