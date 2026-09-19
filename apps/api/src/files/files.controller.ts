import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser, TenantId } from '../tenancy/decorators';
import type { AuthPrincipal } from '../auth/dto';
import {
  FILE_PURPOSES,
  FilesService,
  MAX_PRIVATE_FILE_BYTES,
  type FilePurpose,
} from './files.service';

const upload = FileInterceptor('file', { limits: { fileSize: MAX_PRIVATE_FILE_BYTES } });
const uuid = new ParseUUIDPipe();

/**
 * Private files: payment slips and ID scans. Every route needs a signed-in member of the tenant —
 * unlike `GET /media/:key`, there is no public way in.
 */
@Controller('files')
@UseGuards(JwtAuthGuard, TenantGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @HttpCode(201)
  @UseInterceptors(upload)
  upload(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthPrincipal,
    @Query('purpose') purpose: string | undefined,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const p = (purpose ?? 'other') as FilePurpose;
    if (!(FILE_PURPOSES as readonly string[]).includes(p)) {
      throw new BadRequestException(`purpose must be one of ${FILE_PURPOSES.join(', ')}`);
    }
    return this.files.upload(tenantId, user.sub, p, file);
  }

  @Get(':id')
  async read(@TenantId() tenantId: string, @Param('id', uuid) id: string, @Res() res: Response) {
    const { data, mimeType, name } = await this.files.read(tenantId, id);
    res.setHeader('Content-Type', mimeType);
    // A slip or a passport must never sit in a shared or browser cache.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${name.replace(/[^\w.\- ]+/g, '_')}"`);
    res.send(data);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id', uuid) id: string) {
    return this.files.remove(tenantId, id);
  }
}
