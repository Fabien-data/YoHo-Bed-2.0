import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { properties } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { CreatePropertyDto, UpdatePropertyDto } from './dto';

@Injectable()
export class PropertyService {
  constructor(private readonly dbs: DatabaseService) {}

  list(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(properties).orderBy(properties.createdAt),
    );
  }

  async get(tenantId: string, id: string) {
    const [row] = await this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(properties).where(eq(properties.id, id)),
    );
    if (!row) throw new NotFoundException('Property not found');
    return row;
  }

  async create(tenantId: string, dto: CreatePropertyDto) {
    const [row] = await this.dbs.withTenant(tenantId, (tx) =>
      tx.insert(properties).values({ tenantId, name: dto.name }).returning(),
    );
    return row;
  }

  async update(tenantId: string, id: string, dto: UpdatePropertyDto) {
    const [row] = await this.dbs.withTenant(tenantId, (tx) =>
      tx
        .update(properties)
        .set({ name: dto.name, updatedAt: new Date() })
        .where(eq(properties.id, id))
        .returning(),
    );
    if (!row) throw new NotFoundException('Property not found');
    return row;
  }
}
