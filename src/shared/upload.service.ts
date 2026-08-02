import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import COS from 'cos-nodejs-sdk-v5';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { formatShanghaiDate } from './shanghai-time.utils';

/** 允许上传的图片 MIME 类型白名单 */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** 最大文件大小 5MB */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** MIME 类型到文件扩展名的映射 */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export interface UploadResult {
  /** 文件的完整访问 URL（CDN 或 COS 原始 URL） */
  url: string;
  /** COS 中的对象 Key */
  key: string;
}

/**
 * 腾讯云 COS 文件上传服务。
 *
 * 提供图片上传能力，支持：
 * - 自动根据 MIME 类型校验文件合法性
 * - 生成唯一对象 Key 避免冲突
 * - 可选 CDN 域名加速
 *
 * 未配置 COS 凭证时，所有上传方法抛出 ServiceUnavailableException。
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly client: COS | null;
  private readonly bucket: string;
  private readonly region: string;
  private readonly cdnDomain: string;
  private readonly pathPrefix: string;

  constructor(private readonly configService: ConfigService) {
    const secretId = configService.get<string>('tencentCos.secretId') ?? '';
    const secretKey = configService.get<string>('tencentCos.secretKey') ?? '';
    this.bucket = configService.get<string>('tencentCos.bucket') ?? '';
    this.region = configService.get<string>('tencentCos.region') ?? '';
    this.cdnDomain = configService.get<string>('tencentCos.cdnDomain') ?? '';
    this.pathPrefix =
      configService.get<string>('tencentCos.pathPrefix') ?? 'uploads/';

    if (secretId && secretKey && this.bucket && this.region) {
      this.client = new COS({
        SecretId: secretId,
        SecretKey: secretKey,
      });
      this.logger.log(
        `腾讯云 COS 客户端已初始化（bucket: ${this.bucket}, region: ${this.region}）`,
      );
    } else {
      this.client = null;
      this.logger.warn('腾讯云 COS 凭证未配置，文件上传功能不可用');
    }
  }

  /**
   * 上传图片文件到 COS。
   *
   * @param fileBuffer 文件二进制内容
   * @param mimeType 文件 MIME 类型
   * @param originalName 原始文件名（用于生成可读的 Key 后缀）
   * @returns 上传结果（URL + Key）
   */
  async uploadImage(
    fileBuffer: Buffer,
    mimeType: string,
    originalName?: string,
  ): Promise<UploadResult> {
    this.ensureEnabled();
    this.validateImage(mimeType, fileBuffer.length);

    const ext = MIME_TO_EXT[mimeType] ?? '.bin';
    const key = this.generateKey(originalName, ext);

    return new Promise<UploadResult>((resolve, reject) => {
      this.client!.putObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          Body: fileBuffer,
          ContentType: mimeType,
          // 公共读：图片需要被前端直接访问
          ACL: 'public-read',
          CacheControl: 'max-age=31536000, immutable',
        },
        (err) => {
          if (err) {
            this.logger.error(`COS 上传失败 (key: ${key})`, err.message);
            reject(new ServiceUnavailableException('文件上传失败，请稍后重试'));
            return;
          }
          const url = this.buildUrl(key);
          this.logger.log(`文件上传成功: ${url}`);
          resolve({ url, key });
        },
      );
    });
  }

  /**
   * 删除 COS 中的对象。
   * 用于用户更换头像时清理旧文件，避免存储浪费。
   */
  async deleteObject(key: string): Promise<void> {
    if (!this.client) return;

    return new Promise<void>((resolve, reject) => {
      this.client!.deleteObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
        },
        (err) => {
          if (err) {
            this.logger.warn(`COS 删除对象失败 (key: ${key}): ${err.message}`);
            // 删除失败不阻塞主流程，仅记录警告
            resolve();
            return;
          }
          this.logger.log(`对象删除成功: ${key}`);
          resolve();
        },
      );
    });
  }

  /** 检查 COS 是否已配置可用 */
  isAvailable(): boolean {
    return this.client !== null;
  }

  /** 确保 COS 服务已启用 */
  private ensureEnabled(): void {
    if (!this.client) {
      throw new ServiceUnavailableException('文件上传服务未配置，请联系管理员');
    }
  }

  /** 校验图片类型和大小 */
  private validateImage(mimeType: string, size: number): void {
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new ServiceUnavailableException(
        `不支持的文件类型: ${mimeType}，仅允许 ${[...ALLOWED_MIME_TYPES].join(', ')}`,
      );
    }
    if (size > MAX_FILE_SIZE) {
      throw new ServiceUnavailableException(
        `文件大小超出限制（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）`,
      );
    }
  }

  /**
   * 生成 COS 对象 Key。
   * 格式：{pathPrefix}{YYYY/MM/DD}/{uuid}{ext}
   * 按日期分目录便于管理，UUID 保证唯一性。
   */
  private generateKey(originalName: string | undefined, ext: string): string {
    // 按上海时区分目录，保证同一营业日的文件落在同一目录
    const datePath = formatShanghaiDate(Date.now()).replace(/-/g, '/');

    const uuid = crypto.randomUUID().replace(/-/g, '');
    // 从原始文件名提取无扩展名的部分，做安全清理
    const baseName = originalName
      ? path
          .basename(originalName, path.extname(originalName))
          .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_')
          .slice(0, 50)
      : '';

    const prefix = this.pathPrefix.endsWith('/')
      ? this.pathPrefix
      : `${this.pathPrefix}/`;

    return baseName
      ? `${prefix}${datePath}/${baseName}_${uuid}${ext}`
      : `${prefix}${datePath}/${uuid}${ext}`;
  }

  /** 构建文件访问 URL（优先 CDN，否则 COS 原始 URL） */
  private buildUrl(key: string): string {
    if (this.cdnDomain) {
      const domain = this.cdnDomain.endsWith('/')
        ? this.cdnDomain.slice(0, -1)
        : this.cdnDomain;
      return `${domain}/${key}`;
    }
    return `https://${this.bucket}.cos.${this.region}.myqcloud.com/${key}`;
  }
}
