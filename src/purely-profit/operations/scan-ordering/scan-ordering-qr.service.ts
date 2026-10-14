import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { isProductionEnvironment } from '../../../shared/qr-public-url.utils';
import { reportScanQrBaseUrlStatus } from '../../../shared/scan-qr-base-url-status.utils';
import {
  buildScanOrderingQrTokenSecrets,
  decryptScanOrderingQrToken,
  resolveScanOrderingQrTokenKeys,
  type ScanOrderingQrTokenKeyConfig,
  type ScanOrderingQrTokenSecrets,
} from '../../../shared/scan-ordering-qr-token-codec.utils';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { buildScanOrderingTableQrPayload } from '../scan-qr-payload.utils';
import type {
  ScanOrderingQrCodeExportItem,
  ScanOrderingQrCodeListItem,
  ScanOrderingQrCodeResponse,
} from './scan-ordering-qr.types';

/** 桌台二维码服务常量。 */
const SCAN_ORDERING_QR_CODE_SIZE = 240;
/** 桌码列表缓存时长（秒）：列表只在轮换 / 作废后失效，读远多于写。 */
const QR_CODE_LIST_CACHE_TTL_SECONDS = 300;

/** 新写入的桌码记录的最小投影。 */
interface CreatedQrCodeRow {
  id: number;
  version: number;
}

/** 扫码点餐桌码管理服务：编排「权限校验 → 存取 → 出图」，加解密细节在 codec util。 */
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
    const storeId = await this.requireTableStoreId(user, tableId);
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
  ): Promise<ScanOrderingQrCodeListItem[]> {
    const storeId = await this.requireTableStoreId(user, tableId);
    const cacheKey = this.buildQrCodeCacheKey(storeId, tableId);
    const cachedCodes =
      await this.redisService.getJson<ScanOrderingQrCodeListItem[]>(cacheKey);
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
    await this.redisService.set(
      cacheKey,
      JSON.stringify(response),
      QR_CODE_LIST_CACHE_TTL_SECONDS,
    );
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

  async exportQrCodes(
    user: AuthenticatedUser,
  ): Promise<ScanOrderingQrCodeExportItem[]> {
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

  /** 校验操作者对桌台所属门店的管理权限，并确认桌台存在。 */
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
    const secrets = this.buildTokenSecrets(token);

    let qrCode: CreatedQrCodeRow;
    try {
      qrCode = await this.insertNextVersion({
        storeId,
        tableId,
        secrets,
        revokeCurrentCode,
      });
    } catch (error) {
      // 并发建码会撞同一版本唯一约束：先把残留的 active 桌码作废再重试一次。
      // 这里不能让冲突冒泡成 500 —— 商家端点「轮换」失败会以为操作没生效。
      if (!isUniqueConstraintError(error)) throw error;
      await this.revokeActiveQrCodes(tableId);
      qrCode = await this.insertNextVersion({
        storeId,
        tableId,
        secrets,
        revokeCurrentCode: false,
      });
    }

    await this.invalidateQrCodeCache(storeId, tableId);
    return this.toQrCodeResponse(qrCode.id, tableId, qrCode.version, token);
  }

  /**
   * 在单个事务内作废旧码（可选）并写入下一版本桌码。
   *
   * 作废与取版本号必须在同一事务里：否则并发轮换会算出同一个 version，
   * 后写的一行撞唯一约束。
   */
  private insertNextVersion(params: {
    storeId: number;
    tableId: number;
    secrets: Required<ScanOrderingQrTokenSecrets>;
    revokeCurrentCode: boolean;
  }): Promise<CreatedQrCodeRow> {
    return this.prisma.$transaction(async (tx) => {
      if (params.revokeCurrentCode) {
        await tx.scanOrderingTableQrCode.updateMany({
          where: { tableId: params.tableId, status: 'active' },
          data: { status: 'revoked', revokedAt: new Date() },
        });
      }
      const latestQrCode = await tx.scanOrderingTableQrCode.findFirst({
        where: { tableId: params.tableId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return tx.scanOrderingTableQrCode.create({
        data: {
          storeId: params.storeId,
          tableId: params.tableId,
          tokenHash: params.secrets.tokenHash,
          tokenCiphertext: params.secrets.tokenCiphertext,
          tokenPrefix: params.secrets.tokenPrefix,
          version: (latestQrCode?.version ?? 0) + 1,
        },
        select: { id: true, version: true },
      });
    });
  }

  private async revokeActiveQrCodes(tableId: number): Promise<void> {
    await this.prisma.scanOrderingTableQrCode.updateMany({
      where: { tableId, status: 'active' },
      data: { status: 'revoked', revokedAt: new Date() },
    });
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

  /** 桌码必须有密文可回读（商家端要重新出图），因此缺密钥时直接失败。 */
  private buildTokenSecrets(
    token: string,
  ): Required<ScanOrderingQrTokenSecrets> {
    const secrets = this.guardCrypto(() =>
      buildScanOrderingQrTokenSecrets(token, this.readTokenKeyConfig()),
    );
    if (!secrets.tokenCiphertext) {
      throw new InternalServerErrorException('未配置桌码加密密钥');
    }
    return { ...secrets, tokenCiphertext: secrets.tokenCiphertext };
  }

  /**
   * 解密桌码 token。
   *
   * 依次尝试当前密钥 → 上一代密钥 → JWT_SECRET 派生密钥：
   * 密钥轮换后，轮换前生成的历史桌码仍能被重新下载 / 导出。
   */
  private decryptToken(ciphertext: string): string {
    const token = this.guardCrypto(() =>
      decryptScanOrderingQrToken(
        ciphertext,
        resolveScanOrderingQrTokenKeys(this.readTokenKeyConfig()),
      ),
    );
    if (!token) {
      throw new InternalServerErrorException(
        '桌码加密数据无法解密：密钥可能已轮换，请检查 ' +
          'SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY / ' +
          'SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY_PREVIOUS 配置，' +
          '或轮换桌码后重新下载',
      );
    }
    return token;
  }

  /** codec util 抛的是纯 Error，这里统一转成 500 并保留原提示文案。 */
  private guardCrypto<T>(run: () => T): T {
    try {
      return run();
    } catch (error) {
      throw new InternalServerErrorException((error as Error).message);
    }
  }

  private readTokenKeyConfig(): ScanOrderingQrTokenKeyConfig {
    return {
      current: this.configService.get<string>(
        'scanOrdering.qrTokenEncryptionKey',
      ),
      previous: this.configService.get<string>(
        'scanOrdering.qrTokenEncryptionKeyPrevious',
      ),
      jwtSecret: this.configService.get<string>('jwt.secret'),
    };
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

/** 判断是否命中唯一约束冲突（并发轮换 / 补码会撞同一版本行）。 */
function isUniqueConstraintError(error: unknown): boolean {
  const { message, code } = (error ?? {}) as {
    message?: string;
    code?: string;
  };
  return Boolean(message?.includes('Unique constraint') || code === 'P2002');
}
