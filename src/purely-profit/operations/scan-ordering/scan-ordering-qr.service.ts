import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import QRCode from 'qrcode';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { isProductionEnvironment } from '../../../shared/qr-public-url.utils';
import { reportScanQrBaseUrlStatus } from '../../../shared/scan-qr-base-url-status.utils';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { buildScanOrderingTableQrPayload } from '../scan-qr-payload.utils';

/** 桌台二维码创建结果，明文 token 仅在本次创建响应返回。 */
export interface ScanOrderingQrCodeResponse {
  /** 二维码记录主键。 */
  id: number;
  /** 桌台主键。 */
  tableId: number;
  /** 桌码版本。 */
  version: number;
  /** 仅本次响应返回的不可枚举扫码 token。 */
  token: string;
  /** 二维码图片 Data URL（base64 PNG），可直接用于前端<img>标签。 */
  qrCodeImageUrl: string;
}

/** 桌台二维码服务常量。 */
const SCAN_ORDERING_QR_CODE_SIZE = 240;

/** 扫码点餐桌码管理服务。 */
@Injectable()
export class ScanOrderingQrService implements OnModuleInit {
  private readonly logger = new Logger(ScanOrderingQrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 启动期把「二维码长期有效性」相关的配置风险显式暴露出来。
   *
   * 只告警不阻断启动：这些配置目前允许缺省（缺省即回退历史行为），
   * 但它们一旦出错，后果是**已印刷物料不可逆失效**，必须能被看见。
   */
  onModuleInit(): void {
    this.reportQrBaseUrlStatus();
    this.reportEncryptionKeyStatus();
  }

  /**
   * 桌码 / 空间码共用的扫码域名状态。
   *
   * ⚠️ 域名一旦写进已印刷物料就是永久资产：换域名 / 备案注销 / 微信
   * 「扫普通链接二维码」规则被删，都会让全部已印桌码与空间码同时失效，且服务端
   * 无法补救（改不了纸上印的内容；微信按 URL 文本前缀匹配规则，也不会去
   * fetch 旧域名做跳转）。因此「配了但被判定非法」这种静默回退要显式告警。
   *
   * 逻辑抽到 `reportScanQrBaseUrlStatus`：空间码（`SpaceQrCodeService`）复用
   * 同一份实现，且按域名取值去重，两个 service 只播报一次。
   */
  private reportQrBaseUrlStatus(): void {
    reportScanQrBaseUrlStatus(
      this.logger,
      this.configService.get<string>('club.scanQrBaseUrl'),
    );
  }

  /**
   * 加密密钥状态。
   *
   * 未显式配置 `SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY` 时密钥由 JWT_SECRET 派生，
   * JWT_SECRET 轮换会让历史桌码的 tokenCiphertext 全部解不开（扫码不受影响，
   * 走 tokenHash；但「重新下载 / 批量导出」会 500）。
   */
  private reportEncryptionKeyStatus(): void {
    if (this.configService.get<string>('scanOrdering.qrTokenEncryptionKey')) {
      return;
    }

    const message =
      '未配置 SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY，桌码加密密钥由 JWT_SECRET 派生：' +
      'JWT_SECRET 轮换后历史桌码将无法解密，商家端重新下载 / 导出会失败。' +
      '请显式配置 32 字节 Base64 密钥（轮换期间可用 ' +
      'SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY_PREVIOUS 保留旧密钥）';

    if (isProductionEnvironment()) {
      this.logger.error(message);
      return;
    }
    this.logger.warn(message);
  }

  async rotateQrCode(
    user: AuthenticatedUser,
    tableId: number,
  ): Promise<ScanOrderingQrCodeResponse> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:table-manage',
      '无权管理扫码点餐桌码',
    );
    const table = await this.prisma.scanOrderingTable.findFirst({
      where: { id: tableId, storeId, deletedAt: null },
      select: { id: true },
    });
    if (!table) {
      throw new NotFoundException('扫码点餐桌台不存在');
    }

    return this.createQrCode(storeId, tableId, true);
  }

  async getCurrentQrCode(
    user: AuthenticatedUser,
    tableId: number,
  ): Promise<ScanOrderingQrCodeResponse> {
    const storeId = await this.requireTableStoreId(user, tableId);
    const qrCode = await this.prisma.scanOrderingTableQrCode.findFirst({
      where: { storeId, tableId, status: 'active' },
      select: {
        id: true,
        version: true,
        tokenCiphertext: true,
      },
    });
    if (!qrCode) {
      throw new NotFoundException('当前桌台没有有效二维码');
    }
    if (!qrCode.tokenCiphertext) {
      throw new NotFoundException(
        '当前桌码为历史版本，无法重新下载，请明确轮换后使用新桌码',
      );
    }

    const token = this.decryptToken(qrCode.tokenCiphertext);
    return this.toQrCodeResponse(qrCode.id, tableId, qrCode.version, token);
  }

  async listQrCodes(
    user: AuthenticatedUser,
    tableId: number,
  ): Promise<
    Array<{
      id: number;
      version: number;
      status: string;
      createdAt: string;
      revokedAt: string | null;
    }>
  > {
    const storeId = await this.requireTableStoreId(user, tableId);
    const cacheKey = this.buildQrCodeCacheKey(storeId, tableId);
    const cachedCodes = await this.redisService.getJson<
      Array<{
        id: number;
        version: number;
        status: string;
        createdAt: string;
        revokedAt: string | null;
      }>
    >(cacheKey);
    if (cachedCodes) return cachedCodes;

    const codes = await this.prisma.scanOrderingTableQrCode.findMany({
      where: { storeId, tableId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        status: true,
        createdAt: true,
        revokedAt: true,
      },
    });
    const response = codes.map((code) => ({
      ...code,
      createdAt: code.createdAt.toISOString(),
      revokedAt: code.revokedAt?.toISOString() ?? null,
    }));
    await this.redisService.set(cacheKey, JSON.stringify(response), 300);
    return response;
  }

  async revokeQrCode(
    user: AuthenticatedUser,
    tableId: number,
    qrCodeId: number,
  ): Promise<void> {
    const storeId = await this.requireTableStoreId(user, tableId);
    const result = await this.prisma.scanOrderingTableQrCode.updateMany({
      where: { id: qrCodeId, tableId, storeId, status: 'active' },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('有效桌码不存在');
    await this.invalidateQrCodeCache(storeId, tableId);
  }

  async exportQrCodes(user: AuthenticatedUser): Promise<
    Array<{
      tableId: number;
      tableCode: string;
      tableName: string;
      qrCodeVersion: number;
      qrCodeStatus: string;
    }>
  > {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:table-manage',
      '无权导出扫码点餐桌码',
    );
    const codes = await this.prisma.scanOrderingTableQrCode.findMany({
      where: { storeId },
      orderBy: [{ tableId: 'asc' }, { version: 'desc' }],
      select: {
        tableId: true,
        version: true,
        status: true,
        table: { select: { tableCode: true, name: true } },
      },
    });
    return codes.map((code) => ({
      tableId: code.tableId,
      tableCode: code.table.tableCode,
      tableName: code.table.name,
      qrCodeVersion: code.version,
      qrCodeStatus: code.status,
    }));
  }

  async createInitialQrCode(
    storeId: number,
    tableId: number,
  ): Promise<ScanOrderingQrCodeResponse> {
    return this.createQrCode(storeId, tableId, false);
  }

  private async requireTableStoreId(
    user: AuthenticatedUser,
    tableId: number,
  ): Promise<number> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:table-manage',
      '无权管理扫码点餐桌码',
    );
    const table = await this.prisma.scanOrderingTable.findFirst({
      where: { id: tableId, storeId, deletedAt: null },
      select: { id: true },
    });
    if (!table) throw new NotFoundException('扫码点餐桌台不存在');
    return storeId;
  }

  private async createQrCode(
    storeId: number,
    tableId: number,
    revokeCurrentCode: boolean,
  ): Promise<ScanOrderingQrCodeResponse> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    let qrCode;
    try {
      qrCode = await this.prisma.$transaction(async (tx) => {
        const latestQrCode = await tx.scanOrderingTableQrCode.findFirst({
          where: { tableId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        if (revokeCurrentCode) {
          await tx.scanOrderingTableQrCode.updateMany({
            where: { tableId, status: 'active' },
            data: { status: 'revoked', revokedAt: new Date() },
          });
        }
        const version = (latestQrCode?.version ?? 0) + 1;
        return tx.scanOrderingTableQrCode.create({
          data: {
            storeId,
            tableId,
            tokenHash,
            tokenCiphertext: this.encryptToken(token),
            tokenPrefix: token.slice(0, 8),
            version,
          },
          select: { id: true, version: true },
        });
      });
    } catch (error) {
      // 检查是否为唯一约束冲突（如 table_id 冲突）
      if (
        error.message?.includes('Unique constraint') ||
        error.code === 'P2002'
      ) {
        // 先手动 revoking 所有该桌台的 active 二维码
        await this.prisma.scanOrderingTableQrCode.updateMany({
          where: { tableId, status: 'active' },
          data: { status: 'revoked', revokedAt: new Date() },
        });

        // 重试创建
        qrCode = await this.prisma.$transaction(async (tx) => {
          const latestQrCode = await tx.scanOrderingTableQrCode.findFirst({
            where: { tableId },
            orderBy: { version: 'desc' },
            select: { version: true },
          });
          const version = (latestQrCode?.version ?? 0) + 1;
          return tx.scanOrderingTableQrCode.create({
            data: {
              storeId,
              tableId,
              tokenHash,
              tokenCiphertext: this.encryptToken(token),
              tokenPrefix: token.slice(0, 8),
              version,
            },
            select: { id: true, version: true },
          });
        });
      } else {
        throw error;
      }
    }

    await this.invalidateQrCodeCache(storeId, tableId);
    return this.toQrCodeResponse(qrCode.id, tableId, qrCode.version, token);
  }

  private async toQrCodeResponse(
    id: number,
    tableId: number,
    version: number,
    token: string,
  ): Promise<ScanOrderingQrCodeResponse> {
    // 二维码内容优先使用稳定 URL（「扫普通链接二维码打开小程序」要求载荷是
    // http/https URL），未配置 SCAN_QR_BASE_URL 时回退裸 token，
    // 保证已印刷桌码与本机联调不受影响。
    const payload = buildScanOrderingTableQrPayload(token, {
      baseUrl: this.configService.get<string>('club.scanQrBaseUrl'),
    });
    // 空载荷说明 token 形态非法（正常由本服务生成，出现即内部错误）。
    // 必须在这里拦住：否则会出一张内容为空/无效的二维码图片，商家端显示
    // 「成功」，打印后才发现扫不出来——失效在纸面上是不可逆的。
    if (!payload) {
      throw new InternalServerErrorException(
        '桌码内容生成失败，请重新轮换桌码',
      );
    }
    const qrCodeImageUrl = await QRCode.toDataURL(payload, {
      width: SCAN_ORDERING_QR_CODE_SIZE,
      margin: 0,
      type: 'image/png',
    });
    return { id, tableId, version, token, qrCodeImageUrl };
  }

  private encryptToken(token: string): string {
    const key = this.getPrimaryEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, ciphertext]
      .map((part) => part.toString('base64url'))
      .join('.');
  }

  /**
   * 解密桌码 token。
   *
   * 依次尝试当前密钥 → 上一代密钥 → JWT_SECRET 派生密钥：
   * 密钥轮换后，轮换前生成的历史桌码仍能被重新下载 / 导出。
   */
  private decryptToken(ciphertext: string): string {
    const [encodedIv, encodedAuthTag, encodedToken, ...extraParts] =
      ciphertext.split('.');
    if (
      !encodedIv ||
      !encodedAuthTag ||
      !encodedToken ||
      extraParts.length > 0
    ) {
      throw new InternalServerErrorException('桌码加密数据无效');
    }

    const iv = Buffer.from(encodedIv, 'base64url');
    const authTag = Buffer.from(encodedAuthTag, 'base64url');
    const encrypted = Buffer.from(encodedToken, 'base64url');

    for (const key of this.resolveEncryptionKeys()) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([
          decipher.update(encrypted),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        // 该候选密钥解不开（GCM 校验失败），继续尝试下一个
      }
    }

    throw new InternalServerErrorException(
      '桌码加密数据无法解密：密钥可能已轮换，请检查 ' +
        'SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY / ' +
        'SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY_PREVIOUS 配置，' +
        '或轮换桌码后重新下载',
    );
  }

  /** 加密用的主密钥：优先显式配置的当前密钥，缺失时回退派生密钥。 */
  private getPrimaryEncryptionKey(): Buffer {
    const [primary] = this.resolveEncryptionKeys();
    return primary;
  }

  /**
   * 解密候选密钥（按优先级，已去重）：
   * 当前显式密钥 → 上一代显式密钥 → JWT_SECRET 派生密钥。
   */
  private resolveEncryptionKeys(): Buffer[] {
    const current = this.readExplicitKey('scanOrdering.qrTokenEncryptionKey');
    const previous = this.readExplicitKey(
      'scanOrdering.qrTokenEncryptionKeyPrevious',
    );
    const derived = this.deriveKeyFromJwtSecret();

    const candidates = [current, previous, derived].filter(
      (key): key is Buffer => key !== null,
    );
    if (candidates.length === 0) {
      throw new InternalServerErrorException('未配置桌码加密密钥');
    }

    const unique = new Map<string, Buffer>();
    for (const key of candidates) {
      unique.set(key.toString('hex'), key);
    }
    return [...unique.values()];
  }

  /** 读取显式配置的密钥；未配置返回 null，长度非法直接抛错。 */
  private readExplicitKey(configPath: string): Buffer | null {
    const encodedKey = this.configService.get<string>(configPath);
    if (!encodedKey) {
      return null;
    }
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32) {
      throw new InternalServerErrorException(
        '桌码加密密钥必须为 32 字节 Base64 值',
      );
    }
    return key;
  }

  /**
   * 由 JWT_SECRET 派生的兜底密钥。
   *
   * 仅为兼容「从未显式配置过密钥」的历史部署保留：JWT_SECRET 一旦轮换，
   * 这些密文就再也解不开，因此生产环境必须显式配置独立密钥。
   */
  private deriveKeyFromJwtSecret(): Buffer | null {
    const jwtSecret = this.configService.get<string>('jwt.secret');
    if (!jwtSecret) {
      return null;
    }
    return createHash('sha256')
      .update(`scan-ordering-qr-token:${jwtSecret}`)
      .digest();
  }

  private buildQrCodeCacheKey(storeId: number, tableId: number): string {
    return `scan-ordering:qr-codes:${storeId}:${tableId}`;
  }

  private async invalidateQrCodeCache(
    storeId: number,
    tableId: number,
  ): Promise<void> {
    await this.redisService.del(this.buildQrCodeCacheKey(storeId, tableId));
  }
}
