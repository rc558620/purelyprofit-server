import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isProductionEnvironment } from '../../../shared/qr-public-url.utils';
import {
  buildScanOrderingQrTokenSecrets,
  decryptScanOrderingQrToken,
  resolveScanOrderingQrTokenKeys,
  type ScanOrderingQrTokenKeyConfig,
  type ScanOrderingQrTokenSecrets,
} from '../../../shared/scan-ordering-qr-token-codec.utils';

/** 已落库所需的完整派生数据：建码链路必须能回读明文，因此密文不可为空。 */
export type ResolvedScanOrderingQrTokenSecrets =
  Required<ScanOrderingQrTokenSecrets>;

/**
 * 桌码密文不可还原时的对外提示。
 *
 * 明文只存在于密文中，密钥一旦丢失就无法还原，唯一出路是轮换重生；
 * 因此文案只说「该做什么」，不出现环境变量名（配置细节不对外）。
 */
const QR_TOKEN_UNRECOVERABLE_MESSAGE =
  '当前桌码已无法还原，请「轮换二维码」后重新下载';

/** 桌码密文不可还原的错误码（便于前端分支与工单检索）。 */
const SCAN_QR_TOKEN_UNRECOVERABLE_CODE = 'SCAN_QR_TOKEN_UNRECOVERABLE';

/** 桌码加密 / 生成失败的错误码。 */
const SCAN_QR_TOKEN_ENCRYPT_FAILED_CODE = 'SCAN_QR_TOKEN_ENCRYPT_FAILED';

/** 加解密失败时的对外提示与错误码。 */
interface CryptoFailure {
  message: string;
  code: string;
}

/** 解密失败时要落日志的排查线索（只进日志，不进响应）。 */
export interface ScanOrderingQrTokenDecryptContext {
  tableId: number;
  qrCodeId: number;
}

/**
 * 桌码 token 的密钥与编解码服务。
 *
 * 独立成 service 的原因：密钥配置、密钥轮换兼容与失败文案是一条完整的
 * 「长期可用性」链路，与桌码存取 / 出图无关，混在编排服务里会让两侧改动互相牵连。
 * 真正的算法实现仍在 `shared/scan-ordering-qr-token-codec.utils.ts`。
 */
@Injectable()
export class ScanOrderingQrTokenService {
  private readonly logger = new Logger(ScanOrderingQrTokenService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * 启动期加密密钥告警。
   *
   * 未显式配置 `SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY` 时密钥由 JWT_SECRET 派生，
   * JWT_SECRET 轮换会让历史桌码的 tokenCiphertext 全部解不开（扫码不受影响，
   * 走 tokenHash；但「重新下载 / 批量导出」会 500）。
   */
  reportEncryptionKeyStatus(): void {
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

  /** 桌码必须有密文可回读（商家端要重新出图），因此缺密钥时直接失败。 */
  buildTokenSecrets(token: string): ResolvedScanOrderingQrTokenSecrets {
    const secrets = this.guardCrypto(
      () => buildScanOrderingQrTokenSecrets(token, this.readTokenKeyConfig()),
      {
        message: '桌码生成失败，请稍后重试',
        code: SCAN_QR_TOKEN_ENCRYPT_FAILED_CODE,
      },
      'build-token-secrets',
    );
    if (!secrets.tokenCiphertext) {
      this.logger.error(
        '桌码生成失败：没有任何可用加密密钥（scanOrdering.qrTokenEncryptionKey / jwt.secret 均为空）',
      );
      throw new InternalServerErrorException({
        message: '桌码生成失败，请稍后重试',
        code: SCAN_QR_TOKEN_ENCRYPT_FAILED_CODE,
      });
    }
    return { ...secrets, tokenCiphertext: secrets.tokenCiphertext };
  }

  /**
   * 解密桌码 token。
   *
   * 依次尝试当前密钥 → 上一代密钥 → JWT_SECRET 派生密钥：
   * 密钥轮换后，轮换前生成的历史桌码仍能被重新下载 / 导出。
   *
   * 全部候选都解不开属于**不可逆**故障（写库时的密钥已丢失，明文只存在于密文里），
   * 只能靠轮换桌码重生。因此给商家端的提示只说明可执行动作；具体排查线索
   * （桌台 / 桌码 id、应该检查哪些配置）只落日志，避免把服务端配置细节透传给前端。
   */
  decryptToken(
    ciphertext: string,
    context: ScanOrderingQrTokenDecryptContext,
  ): string {
    const token = this.guardCrypto(
      () =>
        decryptScanOrderingQrToken(
          ciphertext,
          resolveScanOrderingQrTokenKeys(this.readTokenKeyConfig()),
        ),
      {
        message: QR_TOKEN_UNRECOVERABLE_MESSAGE,
        code: SCAN_QR_TOKEN_UNRECOVERABLE_CODE,
      },
      `decrypt-token(tableId=${context.tableId}, qrCodeId=${context.qrCodeId})`,
    );
    if (!token) {
      this.logger.error(
        `桌码密文无法解密：tableId=${context.tableId} qrCodeId=${context.qrCodeId}，` +
          '当前候选密钥（SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY / _PREVIOUS / JWT_SECRET 派生）' +
          '均解不开，说明写库时的密钥已丢失；只能轮换该桌码重生',
      );
      throw new InternalServerErrorException({
        message: QR_TOKEN_UNRECOVERABLE_MESSAGE,
        code: SCAN_QR_TOKEN_UNRECOVERABLE_CODE,
      });
    }
    return token;
  }

  /**
   * codec util 抛的是纯 Error：详细原因（含密钥配置问题）落日志，
   * 前端只拿到调用方指定的可操作提示，不暴露服务端配置项名称。
   */
  private guardCrypto<T>(
    run: () => T,
    failure: CryptoFailure,
    scene: string,
  ): T {
    try {
      return run();
    } catch (error) {
      this.logger.error(
        `桌码加解密失败（${scene}）：${(error as Error).message}`,
      );
      throw new InternalServerErrorException(failure);
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
}
