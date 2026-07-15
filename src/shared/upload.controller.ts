import {
  Controller,
  Post,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiOkResponse,
  ApiProperty,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../purely-profit/auth/guards/jwt-auth.guard';
import { UploadService, UploadResult } from './upload.service';
import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';

class UploadImageResponseDto {
  @ApiProperty({ description: '文件访问 URL' })
  url: string;

  @ApiProperty({ description: 'COS 对象 Key' })
  key: string;
}

/**
 * 通用文件上传接口。
 *
 * 基于 Fastify multipart 插件处理文件流，
 * 前端以 multipart/form-data 方式上传 file 字段。
 */
@Controller('upload')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(private readonly uploadService: UploadService) {}

  @Post('image')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传图片文件（头像、商品图等）' })
  @ApiOkResponse({
    description: '上传成功，返回文件 URL',
    type: UploadImageResponseDto,
  })
  async uploadImage(
    @Req() req: FastifyRequest,
  ): Promise<UploadImageResponseDto> {
    const file = await (
      req as FastifyRequest & { file(): Promise<MultipartFile> }
    ).file();

    if (!file) {
      throw new BadRequestException('未找到上传文件，请使用 file 字段');
    }

    // 校验文件类型
    const mimeType = file.mimetype;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(mimeType)) {
      throw new BadRequestException(
        `不支持的文件类型: ${mimeType}，仅允许 ${allowedTypes.join(', ')}`,
      );
    }

    // 校验文件大小（5MB）
    const MAX_SIZE = 5 * 1024 * 1024;
    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk as Buffer);
    }
    const buffer = Buffer.concat(chunks);

    if (buffer.length > MAX_SIZE) {
      throw new BadRequestException(
        `文件大小超出限制（最大 ${MAX_SIZE / 1024 / 1024}MB）`,
      );
    }

    const result: UploadResult = await this.uploadService.uploadImage(
      buffer,
      mimeType,
      file.filename,
    );

    return { url: result.url, key: result.key };
  }
}
