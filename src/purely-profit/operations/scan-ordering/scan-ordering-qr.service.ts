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
import { reportScanQrBaseUrlStatus } from '../../../shared/scan-qr-base-url-status.utils';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { buildScanOrderingTableQrPayload } from '../scan-qr-payload.utils';
import type {
  ScanOrderingQrCodeExportItem,
  ScanOrderingQrCodeListItem,
  ScanOrderingQrCodeResponse,
} from './scan-ordering-qr.types';
import { ScanOrderingQrTokenService } from './scan-ordering-qr-token.service';
import { ScanOrderingQrStore } from './scan-ordering-qr.store';

/** 桌台二维码服务常量。 */
const SCAN_ORDERING_QR_CODE_SIZE = 240;

/** 桌码管理所需的权限点：轮换 / 作废 / 导出共用。 */
const QR_CODE_MANAGE_PERMISSION = 'scan-ordering:table-manage';

/**
 * 扫码点餐桌码管理服务：编排「权限校验 → 存取 → 出图」。
 *
 * 存取细节在 `ScanOrderingQrStore`，加解密与密钥配置在
 * `ScanOrderingQrTokenService`，本类只保留跨步骤的业务编排。
 */
@Injectable()
export class ScanOrderingQrService implements OnModuleInit {
  private readonly logger = new Logger(ScanOrderingQrService.name);

  constructor(
    private readonly commerceAccessService: CommerceAccessService,
    private readonly configService: ConfigService,
    private readonly qrTokenService: ScanOrderingQrTokenService,
    private readonly qrStore: ScanOrderingQrStore,
  ) {}

  /**
   * 启动期把「二维码长期有效性」相关的配置风险显式暴露出来。
   *
   * 只告警不阻断启动：这些配置目前允许缺省（缺省即回退历史行为），
   * 但它们一旦出错，后果是**已印刷物料不可逆失效**，必须能被看见。
   */
  onModuleInit(): void {
    this.reportQrBaseUrlStatus();
    this.qrTokenService.reportEncryptionKeyStatus();
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
    const qrCode = await this.qrStore.findActiveQrCode(storeId, tableId);
    if (!qrCode) {
      throw new NotFoundException('当前桌台没有有效二维码');
    }
    if (!qrCode.tokenCiphertext) {
      throw new NotFoundException(
        '当前桌码为历史版本，无法重新下载，请明确轮换后使用新桌码',
      );
    }

    const token = this.qrTokenService.decryptToken(qrCode.tokenCiphertext, {
      tableId,
      qrCodeId: qrCode.id,
    });
    return this.toQrCodeResponse(qrCode.id, tableId, qrCode.version, token);
  }

  async listQrCodes(
    user: AuthenticatedUser,
    tableId: number,
  ): Promise<ScanOrderingQrCodeListItem[]> {
    const storeId = await this.requireTableStoreId(user, tableId);
    return this.qrStore.listQrCodes(storeId, tableId);
  }

  async revokeQrCode(
    user: AuthenticatedUser,
    tableId: number,
    qrCodeId: number,
  ): Promise<void> {
    const storeId = await this.requireTableStoreId(user, tableId);
    const revoked = await this.qrStore.revokeQrCode(storeId, tableId, qrCodeId);
    if (!revoked) throw new NotFoundException('有效桌码不存在');
    await this.qrStore.invalidateListCache(storeId, tableId);
  }

  async exportQrCodes(
    user: AuthenticatedUser,
  ): Promise<ScanOrderingQrCodeExportItem[]> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      QR_CODE_MANAGE_PERMISSION,
      '无权导出扫码点餐桌码',
    );
    return this.qrStore.listExportItems(storeId);
  }

  async createInitialQrCode(
    storeId: number,
    tableId: number,
  ): Promise<ScanOrderingQrCodeResponse> {
    return this.createQrCode(storeId, tableId, false);
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

  /** 校验操作者对桌台所属门店的管理权限，并确认桌台存在。 */
  private async requireTableStoreId(
    user: AuthenticatedUser,
    tableId: number,
  ): Promise<number> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      QR_CODE_MANAGE_PERMISSION,
      '无权管理扫码点餐桌码',
    );
    const exists = await this.qrStore.existsTable(storeId, tableId);
    if (!exists) throw new NotFoundException('扫码点餐桌台不存在');
    return storeId;
  }

  private async createQrCode(
    storeId: number,
    tableId: number,
    revokeCurrentCode: boolean,
  ): Promise<ScanOrderingQrCodeResponse> {
    const token = randomBytes(32).toString('base64url');
    const secrets = this.qrTokenService.buildTokenSecrets(token);

    const qrCode = await this.qrStore.createNextVersion({
      storeId,
      tableId,
      secrets,
      revokeCurrentCode,
    });

    await this.qrStore.invalidateListCache(storeId, tableId);
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
}
