import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { media, properties, rooms } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { LocalDiskStorage, type StorageAdapter } from './storage';
import type { Env } from '../config/env';

const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

@Injectable()
export class MediaService {
  private readonly storage: StorageAdapter;

  constructor(
    private readonly dbs: DatabaseService,
    config: ConfigService<Env, true>,
  ) {
    this.storage = new LocalDiskStorage(config.get('MEDIA_DIR', { infer: true }));
  }

  /** Upload a photo for a property or a room (exactly one target). Ownership checked under RLS. */
  async upload(
    tenantId: string,
    target: { propertyId?: string; roomId?: string },
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    const ext = ALLOWED.get(file.mimetype);
    if (!ext) throw new BadRequestException('Only JPEG, PNG or WebP images are allowed');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('Image is larger than 5 MB');

    return this.dbs.withTenant(tenantId, async (tx) => {
      // RLS makes a foreign id invisible, so these lookups double as ownership checks.
      if (target.propertyId) {
        const [p] = await tx.select().from(properties).where(eq(properties.id, target.propertyId));
        if (!p) throw new NotFoundException('Property not found');
      } else if (target.roomId) {
        const [r] = await tx.select().from(rooms).where(eq(rooms.id, target.roomId));
        if (!r) throw new NotFoundException('Room not found');
      } else {
        throw new BadRequestException('A property or room target is required');
      }

      const storageKey = `${randomBytes(16).toString('hex')}.${ext}`;
      await this.storage.save(storageKey, file.buffer);
      const [nextOrder] = await tx
        .select({ n: sql<number>`coalesce(max(${media.sortOrder}), -1) + 1` })
        .from(media)
        .where(
          target.propertyId
            ? and(eq(media.propertyId, target.propertyId), isNull(media.roomId))
            : eq(media.roomId, target.roomId!),
        );
      const [row] = await tx
        .insert(media)
        .values({
          tenantId,
          propertyId: target.propertyId ?? null,
          roomId: target.roomId ?? null,
          storageKey,
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          sortOrder: nextOrder?.n ?? 0,
        })
        .returning();
      return row;
    });
  }

  // NB: `media` carries a permissive public-read policy (media_public_read, for <img> serving),
  // and Postgres ORs permissive policies — so SELECTs on media are NOT tenant-fenced the way every
  // other table is. Every read below must therefore filter on tenant_id explicitly, or a caller
  // could enumerate (and via remove(), destroy the files of) another tenant's photos by uuid.

  listForProperty(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(media)
        .where(
          and(eq(media.tenantId, tenantId), eq(media.propertyId, propertyId), isNull(media.roomId)),
        )
        .orderBy(asc(media.sortOrder)),
    );
  }

  listForRoom(tenantId: string, roomId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(media)
        .where(and(eq(media.tenantId, tenantId), eq(media.roomId, roomId)))
        .orderBy(asc(media.sortOrder)),
    );
  }

  async remove(tenantId: string, id: string) {
    const row = await this.dbs.withTenant(tenantId, async (tx) => {
      const [m] = await tx
        .select()
        .from(media)
        .where(and(eq(media.id, id), eq(media.tenantId, tenantId)));
      if (!m) throw new NotFoundException('Photo not found');
      await tx.delete(media).where(eq(media.id, id));
      return m;
    });
    await this.storage.delete(row.storageKey); // after commit; orphan cleanup is best-effort
    return { deleted: true };
  }

  /**
   * Serve bytes by storage key. Public by design: <img> tags can't send JWT headers, and keys
   * are 128-bit random — unguessable. The DB row provides the content type.
   */
  async serve(storageKey: string) {
    const [row] = await this.dbs.db.select().from(media).where(eq(media.storageKey, storageKey));
    if (!row) throw new NotFoundException('Not found');
    const data = await this.storage.read(row.storageKey).catch(() => null);
    if (!data) throw new NotFoundException('Not found');
    return { data, mimeType: row.mimeType };
  }
}
