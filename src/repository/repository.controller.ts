import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RepositoryService } from './repository.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/types';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

@Controller('repository')
@UseGuards(JwtAuthGuard)
export class RepositoryController {
  constructor(private readonly repositoryService: RepositoryService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  create(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('provider') provider?: string,
  ) {
    if (!file) throw new BadRequestException('Upload a .zip file under the "file" field');
    if (!file.originalname.toLowerCase().endsWith('.zip')) {
      throw new BadRequestException('Only .zip archives are supported');
    }
    return this.repositoryService.createScanJob(user.id, file, provider);
  }

  @Get()
  findRecent(@CurrentUser() user: RequestUser, @Query('limit') limit?: string) {
    return this.repositoryService.findRecent(user.id, limit ? Number(limit) : undefined);
  }

  @Get(':id')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.repositoryService.findOne(user.id, id);
  }
}
