import { InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingQrService } from './scan-ordering-qr.service';

/**
 * 桌码二维码「长期有效性」保护测试。
 *
 * 覆盖三类会让已印刷物料不可逆失效的风险：
 * 1. 载荷为空仍出图（打印出来扫不出来，商家端却显示成功）；
 * 2. 密钥轮换后历史桌码解不开（重新下载 / 批量导出集体 500）；
 * 3. 域名配置错误被静默回退（运维以为生效了，实际出的是历史格式）。
 */
describe('ScanOrderingQrService - 已印刷物料保护', () => {
  const JWT_SECRET = 'test-jwt-secret';
  const TABLE_TOKEN = 'NuSUjOX2ZBWZrLNx4C-nU-lCVKTAsL3xzLJNOkLlZvM';

  const prismaService = {
    scanOrderingTable: { findFirst: jest.fn() },
    scanOrderingTableQrCode: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const redisService = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  const commerceAccessService = { resolveSingleStoreId: jest.fn() };

  /** 与服务端 encryptToken 一致的加密（iv.authTag.ciphertext） */
  const encrypt = (token: string, key: Buffer): string => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((part) => part.toString('base64url'))
      .join('.');
  };

  const buildService = async (
    config: Record<string, string | undefined>,
  ): Promise<ScanOrderingQrService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingQrService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();
    return module.get<ScanOrderingQrService>(ScanOrderingQrService);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(1);
    prismaService.scanOrderingTable.findFirst.mockResolvedValue({ id: 1 });
  });

  describe('载荷为空时拒绝出图', () => {
    it('解密出的 token 形态非法时抛错，不生成二维码图片', async () => {
      const key = createHash('sha256')
        .update(`scan-ordering-qr-token:${JWT_SECRET}`)
        .digest();
      prismaService.scanOrderingTableQrCode.findFirst.mockResolvedValue({
        id: 10,
        version: 1,
        // 非法 token：buildScanOrderingTableQrPayload 会返回空串
        tokenCiphertext: encrypt('short', key),
      });

      const service = await buildService({ 'jwt.secret': JWT_SECRET });

      await expect(service.getCurrentQrCode({} as never, 1)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('密钥轮换后历史桌码仍可解密', () => {
    it('上一代密钥（_PREVIOUS）能解开轮换前生成的密文', async () => {
      const previousKey = randomBytes(32);
      const currentKey = randomBytes(32);
      prismaService.scanOrderingTableQrCode.findFirst.mockResolvedValue({
        id: 10,
        version: 1,
        tokenCiphertext: encrypt(TABLE_TOKEN, previousKey),
      });

      const service = await buildService({
        'scanOrdering.qrTokenEncryptionKey': currentKey.toString('base64'),
        'scanOrdering.qrTokenEncryptionKeyPrevious':
          previousKey.toString('base64'),
      });

      const result = await service.getCurrentQrCode({} as never, 1);

      expect(result.token).toBe(TABLE_TOKEN);
    });

    it('全部候选密钥都解不开时给出可排查的提示', async () => {
      prismaService.scanOrderingTableQrCode.findFirst.mockResolvedValue({
        id: 10,
        version: 1,
        tokenCiphertext: encrypt(TABLE_TOKEN, randomBytes(32)),
      });

      const service = await buildService({
        'scanOrdering.qrTokenEncryptionKey': randomBytes(32).toString('base64'),
      });

      await expect(service.getCurrentQrCode({} as never, 1)).rejects.toThrow(
        /SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY/,
      );
    });
  });

  describe('onModuleInit 配置告警', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('域名非法被静默回退时记 error', async () => {
      process.env.NODE_ENV = 'production';
      const logger = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const service = await buildService({
        'club.scanQrBaseUrl': 'http://localhost:3000',
        'scanOrdering.qrTokenEncryptionKey': randomBytes(32).toString('base64'),
      });
      service.onModuleInit();

      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining('SCAN_QR_BASE_URL'),
      );
      logger.mockRestore();
    });

    it('生产环境未显式配置加密密钥时记 error', async () => {
      process.env.NODE_ENV = 'production';
      const logger = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const service = await buildService({
        'club.scanQrBaseUrl': 'https://scan.purelyprofit.com',
        'jwt.secret': JWT_SECRET,
      });
      service.onModuleInit();

      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining('SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY'),
      );
      logger.mockRestore();
    });
  });
});
