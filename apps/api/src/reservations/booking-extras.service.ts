import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  bookingGuests,
  bookingRemarks,
  bookingRooms,
  bookings,
  customers,
  guestDocuments,
  properties,
  roomUnits,
  users,
  workOrders,
  type Tx,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { addDocuments, cleanDocumentNumber, resolveGuest } from './guest-resolver';
import type { Actor } from './reservation.service';
import type {
  AddBookingGuestDto,
  CreateDocumentDto,
  CreateRemarkDto,
  CreateTaskDto,
  UpdateDocumentDto,
} from './dto';

/**
 * What hangs off a booking besides its money (Development Phase 02, Sprint 4): the other guests
 * in the room, typed remarks, tasks for other departments, and the guests' identity documents.
 *
 * Every id a request names is loaded under RLS before it is used: a foreign key would happily
 * accept another tenant's booking or guest.
 */
@Injectable()
export class BookingExtrasService {
  constructor(private readonly dbs: DatabaseService) {}

  // --- Remarks -------------------------------------------------------------------

  remarks(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      await this.booking(tx, bookingId);
      return tx
        .select({
          id: bookingRemarks.id,
          type: bookingRemarks.type,
          text: bookingRemarks.text,
          createdAt: bookingRemarks.createdAt,
          createdByUserId: bookingRemarks.createdByUserId,
          createdByName: users.name,
        })
        .from(bookingRemarks)
        .leftJoin(users, eq(users.id, bookingRemarks.createdByUserId))
        .where(eq(bookingRemarks.bookingId, bookingId))
        .orderBy(desc(bookingRemarks.createdAt));
    });
  }

  addRemark(actor: Actor, bookingId: string, dto: CreateRemarkDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      await this.booking(tx, bookingId);
      const [row] = await tx
        .insert(bookingRemarks)
        .values({
          tenantId: actor.tenantId,
          bookingId,
          type: dto.type,
          text: dto.text,
          createdByUserId: actor.userId,
        })
        .returning();
      return row;
    });
  }

  /** A remark is taken back by whoever wrote it, or by the owner. */
  deleteRemark(actor: Actor, remarkId: string) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      const [row] = await tx.select().from(bookingRemarks).where(eq(bookingRemarks.id, remarkId));
      if (!row) throw new NotFoundException('Remark not found');
      if (actor.role !== 'OWNER' && row.createdByUserId !== actor.userId) {
        throw new ForbiddenException(
          'Only the person who wrote a remark, or the owner, can delete it',
        );
      }
      await tx.delete(bookingRemarks).where(eq(bookingRemarks.id, remarkId));
      return { id: remarkId, deleted: true };
    });
  }

  // --- Guests in the room ----------------------------------------------------------

  /** The guest the room is booked for, and anyone else staying in it. */
  guests(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const b = await this.booking(tx, bookingId);
      const [primary] = await tx
        .select(guestColumns)
        .from(customers)
        .where(eq(customers.id, b.customerId));
      const others = await tx
        .select(guestColumns)
        .from(bookingGuests)
        .innerJoin(customers, eq(customers.id, bookingGuests.customerId))
        .where(eq(bookingGuests.bookingId, bookingId))
        .orderBy(asc(bookingGuests.createdAt));
      return { primary: primary ?? null, others };
    });
  }

  addGuest(actor: Actor, bookingId: string, dto: AddBookingGuestDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      const b = await this.booking(tx, bookingId);
      const [property] = await tx
        .select({ country: properties.countryCode })
        .from(properties)
        .where(eq(properties.id, b.propertyId));
      const guest = await resolveGuest(tx, actor.tenantId, dto, property?.country ?? 'LK', {
        userId: actor.userId,
      });
      if (guest.id === b.customerId) {
        throw new ConflictException({
          reason: 'already_primary',
          message: `${guest.name} is already the guest this room is booked for`,
        });
      }
      await tx
        .insert(bookingGuests)
        .values({
          tenantId: actor.tenantId,
          bookingId,
          customerId: guest.id,
          createdByUserId: actor.userId,
        })
        .onConflictDoNothing({ target: [bookingGuests.bookingId, bookingGuests.customerId] });
      return { bookingId, customerId: guest.id, name: guest.name, created: guest.created };
    });
  }

  removeGuest(tenantId: string, bookingId: string, customerId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      await this.booking(tx, bookingId);
      const gone = await tx
        .delete(bookingGuests)
        .where(
          and(eq(bookingGuests.bookingId, bookingId), eq(bookingGuests.customerId, customerId)),
        )
        .returning({ id: bookingGuests.id });
      if (gone.length === 0) throw new NotFoundException('That guest is not on this booking');
      return { bookingId, customerId, removed: true };
    });
  }

  // --- Tasks -------------------------------------------------------------------------

  tasks(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      await this.booking(tx, bookingId);
      return tx
        .select({
          id: workOrders.id,
          title: workOrders.title,
          description: workOrders.description,
          department: workOrders.department,
          trigger: workOrders.trigger,
          priority: workOrders.priority,
          status: workOrders.status,
          deadline: workOrders.deadline,
          roomUnitId: workOrders.roomUnitId,
          roomCode: roomUnits.code,
          createdAt: workOrders.createdAt,
        })
        .from(workOrders)
        .leftJoin(roomUnits, eq(roomUnits.id, workOrders.roomUnitId))
        .where(eq(workOrders.bookingId, bookingId))
        .orderBy(asc(workOrders.createdAt));
    });
  }

  addTask(actor: Actor, bookingId: string, dto: CreateTaskDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      const b = await this.booking(tx, bookingId);
      let roomUnitId = dto.roomUnitId ?? null;
      if (roomUnitId) {
        const [unit] = await tx.select().from(roomUnits).where(eq(roomUnits.id, roomUnitId));
        if (!unit || unit.propertyId !== b.propertyId) {
          throw new NotFoundException('Room not found in this property');
        }
      } else if (dto.roomUnitId === undefined) {
        // The room the guest is in, when there is one.
        const [leg] = await tx
          .select({ unit: bookingRooms.roomUnitId })
          .from(bookingRooms)
          .where(and(eq(bookingRooms.bookingId, bookingId), isNull(bookingRooms.releasedAt)))
          .orderBy(asc(bookingRooms.legIndex))
          .limit(1);
        roomUnitId = leg?.unit ?? null;
      }
      const [row] = await tx
        .insert(workOrders)
        .values({
          tenantId: actor.tenantId,
          propertyId: b.propertyId,
          bookingId,
          roomUnitId,
          title: dto.title,
          description: dto.description ?? null,
          department: dto.department,
          trigger: dto.trigger,
          priority: dto.priority,
          deadline: dto.deadline ?? null,
          createdByUserId: actor.userId,
        })
        .returning();
      return row;
    });
  }

  // --- Identity documents -------------------------------------------------------------

  documents(tenantId: string, customerId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      await this.customer(tx, customerId);
      return tx
        .select({
          id: guestDocuments.id,
          type: guestDocuments.type,
          number: guestDocuments.number,
          issuingCountry: guestDocuments.issuingCountry,
          placeOfIssue: guestDocuments.placeOfIssue,
          issuedOn: guestDocuments.issuedOn,
          expiresOn: guestDocuments.expiresOn,
          visaNumber: guestDocuments.visaNumber,
          visaType: guestDocuments.visaType,
          visaExpiresOn: guestDocuments.visaExpiresOn,
          verification: guestDocuments.verification,
          verifiedAt: guestDocuments.verifiedAt,
          verifiedByName: users.name,
          isPrimary: guestDocuments.isPrimary,
          createdAt: guestDocuments.createdAt,
        })
        .from(guestDocuments)
        .leftJoin(users, eq(users.id, guestDocuments.verifiedByUserId))
        .where(eq(guestDocuments.customerId, customerId))
        .orderBy(desc(guestDocuments.isPrimary), desc(guestDocuments.createdAt));
    });
  }

  addDocument(actor: Actor, customerId: string, dto: CreateDocumentDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      await this.customer(tx, customerId);
      const [row] = await addDocuments(tx, actor.tenantId, customerId, [dto], actor.userId);
      if (row!.isPrimary) await this.onlyPrimary(tx, customerId, row!.id);
      return row;
    });
  }

  updateDocument(actor: Actor, documentId: string, dto: UpdateDocumentDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      const [doc] = await tx.select().from(guestDocuments).where(eq(guestDocuments.id, documentId));
      if (!doc) throw new NotFoundException('Document not found');
      const type = dto.type ?? doc.type;
      // A changed type re-checks the number already there: a passport number is no NIC, and a
      // number re-typed as Aadhaar keeps only its last four digits.
      const number =
        dto.number !== undefined || dto.type !== undefined
          ? cleanDocumentNumber(type, dto.number ?? doc.number)
          : undefined;
      const verifiedNow = dto.verification !== undefined && dto.verification !== null;
      const [row] = await tx
        .update(guestDocuments)
        .set({
          ...dto,
          type,
          ...(number !== undefined && { number }),
          ...(dto.verification !== undefined && {
            verifiedByUserId: verifiedNow ? actor.userId : null,
            verifiedAt: verifiedNow ? new Date() : null,
          }),
          updatedAt: new Date(),
        })
        .where(eq(guestDocuments.id, documentId))
        .returning();
      if (row!.isPrimary) await this.onlyPrimary(tx, row!.customerId, row!.id);
      return row;
    });
  }

  deleteDocument(tenantId: string, documentId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const gone = await tx
        .delete(guestDocuments)
        .where(eq(guestDocuments.id, documentId))
        .returning({ id: guestDocuments.id });
      if (gone.length === 0) throw new NotFoundException('Document not found');
      return { id: documentId, deleted: true };
    });
  }

  // --- Helpers ---------------------------------------------------------------------------

  private async booking(tx: Tx, bookingId: string) {
    const [b] = await tx
      .select({
        id: bookings.id,
        propertyId: bookings.propertyId,
        customerId: bookings.customerId,
        status: bookings.status,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    if (!b) throw new NotFoundException('Booking not found');
    return b;
  }

  private async customer(tx: Tx, customerId: string) {
    const [c] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, customerId));
    if (!c) throw new NotFoundException('Guest not found');
    return c;
  }

  /** One primary document per guest. */
  private async onlyPrimary(tx: Tx, customerId: string, keepId: string) {
    await tx
      .update(guestDocuments)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(
        and(
          eq(guestDocuments.customerId, customerId),
          ne(guestDocuments.id, keepId),
          sql`${guestDocuments.isPrimary}`,
        ),
      );
  }
}

const guestColumns = {
  id: customers.id,
  title: customers.title,
  name: customers.name,
  email: customers.email,
  phone: customers.phone,
  nationalityCode: customers.nationalityCode,
  vip: customers.vip,
};
