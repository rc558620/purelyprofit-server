import { InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  decryptSpaceQrToken,
  encryptSpaceQrToken,
  hashSpaceQrToken,
} from '../../../shared/space-qr-token-codec.utils';
import { SpaceQrCodeService } from './space-qr-code.service';

jest.mock('qrcode', () => ({
  toDataURL: jest.fn(),
  toBuffer: jest.fn(),
}));

/**
 * 空间码二维码「已印刷物料保护」测试。
 *
 * 要守住两条：
 * 1. 绝不能出一张**扫不出来**的图 —— 商家端点预览/轮换/下载都显示成功，
 *    失效要等顾客在店里扫不出来才暴露，那时物料已经印在纸上，不可回滚；
 * 2. 绝不能出一张**内容错了**的图 —— 明文列已删除，密文是唯一来源，
 *    解不开必须显式报错，不能静默降级成别的内容。
 */
describe('SpaceQrCodeService - 已印刷物料保护', () => {
  /** 服务端空间码 token 形态：randomUUID()，36 位 */
  const SPACE_TOKEN = '7f1c2f52-7a1f-4a1e-9f2a-3f0a1b2c3d4e';
  const BASE_URL = 'https://scan.purelyprofit.com';
  const KEY = randomBytes(32);

  const toDataURL = QRCode.toDataURL as unknown as jest.Mock;
  const toBuffer = QRCode.toBuffer as unknown as jest.Mock;

  const prisma = {
    space: { findFirst: jest.fn() },
    spaceQrCode: { upsert: jest.fn() },
  };
  const commerceAccessService = { ensureCanAccessStore: jest.fn() };
  const user = { id: 1 } as unknown as AuthenticatedUser;

  const buildService = async (
    config: Record<string, string | undefined> = {},
  ): Promise<SpaceQrCodeService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceQrCodeService,
        { provide: PrismaService, useValue: prisma },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              config[key] ??
              (key === 'space.qrTokenEncryptionKey'
                ? KEY.toString('base64')
                : undefined),
          },
        },
      ],
    }).compile();
    return module.get<SpaceQrCodeService>(SpaceQrCodeService);
  };

  /** 库里只存摘要 + 密文：明文由密文还原 */
  const mockStoredQrCode = (token: string): void => {
    prisma.spaceQrCode.upsert.mockResolvedValue({
      tokenCiphertext: encryptSpaceQrToken(token, KEY),
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.space.findFirst.mockResolvedValue({
      id: 7,
      name: 'A03',
      storeId: 1,
      store: { name: '示例门店' },
    });
    mockStoredQrCode(SPACE_TOKEN);
    toDataURL.mockResolvedValue('data:image/png;base64,stub');
    toBuffer.mockResolvedValue(Buffer.from('stub'));
  });

  describe('载荷内容', () => {
    it('配置域名时出图为 /p/{token} 稳定 URL', async () => {
      const service = await buildService({ 'club.scanQrBaseUrl': BASE_URL });

      const preview = await service.getPreview(user, 7);

      expect(preview.content).toBe(`${BASE_URL}/p/${SPACE_TOKEN}`);
      expect(toDataURL).toHaveBeenCalledWith(
        `${BASE_URL}/p/${SPACE_TOKEN}`,
        expect.objectContaining({ margin: 0 }),
      );
    });

    it('未配置域名时回退历史自定义协议，不影响已印物料', async () => {
      const service = await buildService({ 'club.scanQrBaseUrl': undefined });

      await expect(service.getPreview(user, 7)).resolves.toMatchObject({
        content: `purelyclub://space-scan?token=${SPACE_TOKEN}`,
      });
    });
  });

  describe('落库：只有摘要与密文，没有明文', () => {
    it('轮换时落库摘要与密文，且密文能还原出同一个 token', async () => {
      const service = await buildService({ 'club.scanQrBaseUrl': BASE_URL });

      await service.rotate(user, 7);

      const call = prisma.spaceQrCode.upsert.mock.calls[0][0] as {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      };
      // 明文列已删除：任何分支都不该再出现 token 字段
      expect(call.create.token).toBeUndefined();
      expect(call.update.token).toBeUndefined();

      const rotated = decryptSpaceQrToken(
        call.create.tokenCiphertext as string,
        [KEY],
      ) as string;
      expect(call.create.tokenHash).toBe(hashSpaceQrToken(rotated));
      expect(call.update.tokenHash).toBe(hashSpaceQrToken(rotated));
    });

    it('轮换出图用的是本次生成的明文（不再回读库）', async () => {
      const service = await buildService({ 'club.scanQrBaseUrl': BASE_URL });

      const preview = await service.rotate(user, 7);

      // 库里那条是 SPACE_TOKEN，轮换后必须是另一个新 UUID
      expect(preview.content).not.toBe(`${BASE_URL}/p/${SPACE_TOKEN}`);
      expect(preview.content).toMatch(
        /^https:\/\/scan\.purelyprofit\.com\/p\/[0-9a-f-]{36}$/,
      );
    });
  });

  describe('载荷为空时拒绝出图', () => {
    /** 密文里存的是形态非法的 token：还原后 buildSpaceQrPayload 会返回空串 */
    const mockIllegalToken = (): void => {
      mockStoredQrCode('nope');
    };

    it('getPreview 抛错且不出图', async () => {
      mockIllegalToken();
      const service = await buildService({ 'club.scanQrBaseUrl': BASE_URL });

      await expect(service.getPreview(user, 7)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      expect(toDataURL).not.toHaveBeenCalled();
    });

    it('download 抛错且不出图', async () => {
      mockIllegalToken();
      const service = await buildService({ 'club.scanQrBaseUrl': BASE_URL });

      await expect(service.download(user, 7)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      expect(toBuffer).not.toHaveBeenCalled();
    });
  });

  describe('密文不可用时拒绝出图（明文列已删除，没有回退）', () => {
    it('密文缺失时抛错并提示轮换', async () => {
      prisma.spaceQrCode.upsert.mockResolvedValue({ tokenCiphertext: null });
      const service = await buildService({ 'club.scanQrBaseUrl': BASE_URL });

      await expect(service.getPreview(user, 7)).rejects.toThrow(
        '空间码密文缺失，无法重新出图，请轮换空间码后重新下载',
      );
      expect(toDataURL).not.toHaveBeenCalled();
    });

    it('密文解不开时抛错并指向密钥配置', async () => {
      prisma.spaceQrCode.upsert.mockResolvedValue({
        tokenCiphertext: encryptSpaceQrToken(SPACE_TOKEN, randomBytes(32)),
      });
      const service = await buildService({ 'club.scanQrBaseUrl': BASE_URL });

      await expect(service.getPreview(user, 7)).rejects.toThrow(
        /SPACE_QR_TOKEN_ENCRYPTION_KEY/,
      );
      expect(toDataURL).not.toHaveBeenCalled();
    });

    it('密钥轮换后上一代密钥仍能出图', async () => {
      const previousKey = randomBytes(32);
      prisma.spaceQrCode.upsert.mockResolvedValue({
        tokenCiphertext: encryptSpaceQrToken(SPACE_TOKEN, previousKey),
      });
      const service = await buildService({
        'club.scanQrBaseUrl': BASE_URL,
        'space.qrTokenEncryptionKey': randomBytes(32).toString('base64'),
        'space.qrTokenEncryptionKeyPrevious': previousKey.toString('base64'),
      });

      await expect(service.getPreview(user, 7)).resolves.toMatchObject({
        content: `${BASE_URL}/p/${SPACE_TOKEN}`,
      });
    });
  });

  describe('onModuleInit 配置告警', () => {
    it('未配置域名时记 warn（空间码回退 purelyclub://）', async () => {
      const logger = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const service = await buildService({ 'club.scanQrBaseUrl': '' });
      service.onModuleInit();

      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining('SCAN_QR_BASE_URL'),
      );
      logger.mockRestore();
    });

    it('配置了但被 sanitize 拒绝时记 error（静默回退很危险）', async () => {
      const logger = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      // 缺协议头：任何环境都会被 sanitize 拒绝（不依赖 NODE_ENV）
      const service = await buildService({
        'club.scanQrBaseUrl': 'scan.purelyprofit.com',
      });
      service.onModuleInit();

      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining('SCAN_QR_BASE_URL'),
      );
      logger.mockRestore();
    });

    it('未显式配置加密密钥时告警（密钥由 JWT_SECRET 派生，轮换即失效）', async () => {
      const logger = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      // 测试环境 NODE_ENV=test → 走 warn 分支，无需改动 process.env
      const service = await buildService({
        'space.qrTokenEncryptionKey': '',
        'jwt.secret': 'test-jwt-secret',
      });
      service.onModuleInit();

      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining('SPACE_QR_TOKEN_ENCRYPTION_KEY'),
      );
      logger.mockRestore();
    });

    it('已显式配置加密密钥时不告警', async () => {
      const logger = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const errorLogger = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const service = await buildService({
        'club.scanQrBaseUrl': BASE_URL,
        'space.qrTokenEncryptionKey': KEY.toString('base64'),
      });
      service.onModuleInit();

      expect(logger).not.toHaveBeenCalledWith(
        expect.stringContaining('SPACE_QR_TOKEN_ENCRYPTION_KEY'),
      );
      expect(errorLogger).not.toHaveBeenCalledWith(
        expect.stringContaining('SPACE_QR_TOKEN_ENCRYPTION_KEY'),
      );
      logger.mockRestore();
      errorLogger.mockRestore();
    });
  });
});
