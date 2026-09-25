import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantId } from '../tenancy/decorators';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MediaService, MAX_PHOTO_BYTES } from './media.service';

const photoOrderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).strict();

const upload = FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } });

@Controller()
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('properties/:id/photos')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @UseInterceptors(upload)
  uploadPropertyPhoto(
    @TenantId() tenantId: string,
    @Param('id') propertyId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.mediaService.upload(tenantId, { propertyId }, file);
  }

  @Post('rooms/:id/photos')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @UseInterceptors(upload)
  uploadRoomPhoto(
    @TenantId() tenantId: string,
    @Param('id') roomId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.mediaService.upload(tenantId, { roomId }, file);
  }

  @Get('properties/:id/photos')
  @UseGuards(JwtAuthGuard, TenantGuard)
  listPropertyPhotos(@TenantId() tenantId: string, @Param('id') propertyId: string) {
    return this.mediaService.listForProperty(tenantId, propertyId);
  }

  @Get('rooms/:id/photos')
  @UseGuards(JwtAuthGuard, TenantGuard)
  listRoomPhotos(@TenantId() tenantId: string, @Param('id') roomId: string) {
    return this.mediaService.listForRoom(tenantId, roomId);
  }

  /** The gallery's order; the first photo is the cover. */
  @Put('properties/:id/photos/order')
  @UseGuards(JwtAuthGuard, TenantGuard)
  orderPropertyPhotos(
    @TenantId() tenantId: string,
    @Param('id') propertyId: string,
    @Body(new ZodValidationPipe(photoOrderSchema)) dto: { ids: string[] },
  ) {
    return this.mediaService.reorder(tenantId, { propertyId }, dto.ids);
  }

  @Put('rooms/:id/photos/order')
  @UseGuards(JwtAuthGuard, TenantGuard)
  orderRoomPhotos(
    @TenantId() tenantId: string,
    @Param('id') roomId: string,
    @Body(new ZodValidationPipe(photoOrderSchema)) dto: { ids: string[] },
  ) {
    return this.mediaService.reorder(tenantId, { roomId }, dto.ids);
  }

  @Delete('photos/:id')
  @UseGuards(JwtAuthGuard, TenantGuard)
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.mediaService.remove(tenantId, id);
  }

  /** Public image bytes — see MediaService.serve for why this is unauthenticated. */
  @Get('media/:key')
  async serve(@Param('key') key: string, @Res() res: Response) {
    const { data, mimeType } = await this.mediaService.serve(key);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(data);
  }
}
