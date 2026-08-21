import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { bookingRooms, maintenanceBlocks, roomUnits, type Tx } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { CreateBlockDto, UpdateBlockDto } from './dto';

const EXCLUSION_VIOLATION = '23P01';

/**
 * Rooms taken out of service — the hatched navy bar across Yanolja's tape chart with its reason
 * written along it, and the Unblock / Edit Block context menu behind it.
 */
@Injectable()
export class BlocksService {
  constructor(private readonly dbs: DatabaseService) {}

  list(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: maintenanceBlocks.id,
          roomUnitId: maintenanceBlocks.roomUnitId,
          code: roomUnits.code,
          blockFrom: maintenanceBlocks.blockFrom,
          blockTo: maintenanceBlocks.blockTo,
          reason: maintenanceBlocks.reason,
          releasedAt: maintenanceBlocks.releasedAt,
          createdAt: maintenanceBlocks.createdAt,
        })
        .from(maintenanceBlocks)
        .innerJoin(roomUnits, eq(roomUnits.id, maintenanceBlocks.roomUnitId))
        .where(eq(maintenanceBlocks.propertyId, propertyId))
        .orderBy(asc(maintenanceBlocks.blockFrom)),
    );
  }

  async create(tenantId: string, propertyId: string, userId: string | null, dto: CreateBlockDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [unit] = await tx.select().from(roomUnits).where(eq(roomUnits.id, dto.roomUnitId));
      if (!unit || unit.propertyId !== propertyId) {
        throw new NotFoundException('Room not found in this property');
      }
      await this.assertNoGuest(tx, dto.roomUnitId, dto.blockFrom, dto.blockTo, unit.code);

      try {
        const [created] = await tx
          .insert(maintenanceBlocks)
          .values({
            tenantId,
            propertyId,
            roomUnitId: dto.roomUnitId,
            blockFrom: dto.blockFrom,
            blockTo: dto.blockTo,
            reason: dto.reason,
            blockedByUserId: userId,
          })
          .returning();
        return created;
      } catch (e) {
        if ((e as { code?: string })?.code === EXCLUSION_VIOLATION) {
          throw new ConflictException(`Room ${unit.code} is already blocked over those dates`);
        }
        throw e;
      }
    });
  }

  async update(tenantId: string, id: string, dto: UpdateBlockDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [block] = await tx.select().from(maintenanceBlocks).where(eq(maintenanceBlocks.id, id));
      if (!block) throw new NotFoundException('Block not found');
      if (block.releasedAt) throw new BadRequestException('This block has already been lifted');

      const blockFrom = dto.blockFrom ?? block.blockFrom;
      const blockTo = dto.blockTo ?? block.blockTo;
      if (blockTo <= blockFrom) {
        throw new BadRequestException('blockTo must be after blockFrom');
      }

      const [unit] = await tx.select().from(roomUnits).where(eq(roomUnits.id, block.roomUnitId));
      await this.assertNoGuest(tx, block.roomUnitId, blockFrom, blockTo, unit?.code ?? '');

      try {
        const [updated] = await tx
          .update(maintenanceBlocks)
          .set({ blockFrom, blockTo, reason: dto.reason ?? block.reason, updatedAt: new Date() })
          .where(eq(maintenanceBlocks.id, id))
          .returning();
        return updated;
      } catch (e) {
        if ((e as { code?: string })?.code === EXCLUSION_VIOLATION) {
          throw new ConflictException('Those dates overlap another block on this room');
        }
        throw e;
      }
    });
  }

  /** Put the room back in service. The block is kept, released, so the history survives. */
  async release(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [block] = await tx.select().from(maintenanceBlocks).where(eq(maintenanceBlocks.id, id));
      if (!block) throw new NotFoundException('Block not found');
      const [updated] = await tx
        .update(maintenanceBlocks)
        .set({ releasedAt: new Date(), updatedAt: new Date() })
        .where(eq(maintenanceBlocks.id, id))
        .returning();
      return updated;
    });
  }

  /**
   * A room cannot be taken out of service while someone is in it.
   *
   * The exclusion constraint only stops blocks colliding with other blocks — bookings live in a
   * different table, so this check is the one that stops a guest being blocked out of their room.
   */
  private async assertNoGuest(
    tx: Tx,
    roomUnitId: string,
    from: string,
    to: string,
    code: string,
  ): Promise<void> {
    const [clash] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(bookingRooms)
      .where(
        and(
          eq(bookingRooms.roomUnitId, roomUnitId),
          isNull(bookingRooms.releasedAt),
          lt(bookingRooms.checkin, to),
          gt(bookingRooms.checkout, from),
        ),
      );
    if ((clash?.n ?? 0) > 0) {
      throw new ConflictException(
        `Room ${code} has a guest over those dates. Move them before blocking it.`,
      );
    }
  }
}
