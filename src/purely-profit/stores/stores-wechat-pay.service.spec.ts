import { BadRequestException } from '@nestjs/common';
import { StoresWechatPayService } from './stores-wechat-pay.service';

/** 构造形如 `iv:authTag:ciphertext` 的假密文，用于触发「确认是密文」分支。 */
const FAKE_CIPHERTEXT = 'aGV5aXY:aGFzaHRhZw:Y2lwaGVydGV4dA';

describe('StoresWechatPayService', () => {
  const prisma = {
    storeWechatPayConfig: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const storesReadService = {
    getBoundStoreRecordOrThrow: jest.fn(),
  };

  const encryption = {
    isAvailable: true,
    encrypt: jest.fn((plain: string) => `enc(${plain})`),
    decrypt: jest.fn((enc: string) => {
      const matched = /^enc\((.*)\)$/.exec(enc);
      if (!matched) throw new Error('Invalid encrypted format');
      return matched[1];
    }),
  };

  const configState: Record<string, string | boolean> = {
    'wechat.partner.enabled': false,
  };
  const configService = { get: jest.fn((key: string) => configState[key]) };

  const bindService = { verifyAndPersist: jest.fn() };

  const user = { id: 7 } as never;

  const createService = (): StoresWechatPayService =>
    new StoresWechatPayService(
      prisma as never,
      storesReadService as never,
      encryption as never,
      configService as never,
      bindService as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    configState['wechat.partner.enabled'] = false;
    encryption.isAvailable = true;
    encryption.encrypt.mockImplementation((plain: string) => `enc(${plain})`);
    encryption.decrypt.mockImplementation((enc: string) => {
      const matched = /^enc\((.*)\)$/.exec(enc);
      if (!matched) throw new Error('Invalid encrypted format');
      return matched[1];
    });
    storesReadService.getBoundStoreRecordOrThrow.mockResolvedValue({ id: 9 });
    prisma.storeWechatPayConfig.findUnique.mockResolvedValue(null);
    prisma.storeWechatPayConfig.upsert.mockResolvedValue({
      mchId: '1234567890',
      mchName: '纯利小店',
      apiV3KeyEnc: 'enc(secret)',
      subMchId: null,
      bindStatus: 'pending',
      bindCheckedAt: null,
      bindFailReason: null,
      configuredAt: new Date('2026-06-13T12:00:00.000Z'),
    });
  });

  describe('updateWechatPayConfig', () => {
    it('加密服务不可用时拒绝保存', async () => {
      encryption.isAvailable = false;

      await expect(
        createService().updateWechatPayConfig(user, { mchId: '1234567890' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.storeWechatPayConfig.upsert).not.toHaveBeenCalled();
    });

    it('服务商模式下只改子商户号：不要求密钥加密服务可用', async () => {
      configState['wechat.partner.enabled'] = true;
      encryption.isAvailable = false;

      await expect(
        createService().updateWechatPayConfig(user, {
          mchId: '1234567890',
          mchName: '纯利小店',
        }),
      ).resolves.toBeDefined();
      expect(prisma.storeWechatPayConfig.upsert).toHaveBeenCalled();
    });

    it('服务商模式下携带密钥但加密服务不可用时返回 400，而不是 500', async () => {
      configState['wechat.partner.enabled'] = true;
      encryption.isAvailable = false;

      await expect(
        createService().updateWechatPayConfig(user, {
          mchId: '1234567890',
          mchName: '纯利小店',
          apiV3Key: 'k'.repeat(32),
        }),
      ).rejects.toThrow(BadRequestException);
      // encrypt 抛的是普通 Error，不做前置拦截会被 Nest 转成 500
      expect(encryption.encrypt).not.toHaveBeenCalled();
    });

    it('首次配置缺参抛 400 BadRequest（而非 404 NotFound）', async () => {
      await expect(
        createService().updateWechatPayConfig(user, { mchId: '1234567890' }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.storeWechatPayConfig.upsert).not.toHaveBeenCalled();
    });

    it('首次配置走 upsert，避免并发 create 撞唯一约束', async () => {
      await createService().updateWechatPayConfig(user, {
        mchId: '1234567890',
        mchName: '纯利小店',
        apiV3Key: 'secret',
      });

      // 关键：不再使用「先 findUnique 再 create」的竞态写法
      expect(prisma.storeWechatPayConfig.create).not.toHaveBeenCalled();
      expect(prisma.storeWechatPayConfig.upsert).toHaveBeenCalledTimes(1);

      const [args] = prisma.storeWechatPayConfig.upsert.mock.calls[0];
      expect(args.where).toEqual({ storeId: 9 });
      expect(args.create).toMatchObject({
        storeId: 9,
        mchId: '1234567890',
        mchName: '纯利小店',
      });
    });

    it('已配置时只改商户名称：不动密钥、不刷新 configuredAt', async () => {
      prisma.storeWechatPayConfig.findUnique.mockResolvedValue({
        mchId: '1234567890',
        mchName: '纯利小店',
        apiV3KeyEnc: 'enc(secret)',
        configuredAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await createService().updateWechatPayConfig(user, { mchName: '新店名' });

      const [args] = prisma.storeWechatPayConfig.upsert.mock.calls[0];
      expect(args.update).toEqual({ mchName: '新店名' });
      expect(encryption.encrypt).not.toHaveBeenCalled();
    });

    it('响应不回显 apiV3Key', async () => {
      const result = await createService().updateWechatPayConfig(user, {
        mchId: '1234567890',
        mchName: '纯利小店',
        apiV3Key: 'secret',
      });

      expect(result).toEqual({
        configured: true,
        mchId: '1234567890',
        mchName: '纯利小店',
        bindStatus: 'pending',
        configuredAt: '2026-06-13T12:00:00.000Z',
      });
      expect(JSON.stringify(result)).not.toContain('secret');
    });

    it('保存后失效 APIv3Key 缓存', async () => {
      prisma.storeWechatPayConfig.findMany.mockResolvedValue([]);
      const service = createService();

      await service.listAllApiV3Keys();
      await service.listAllApiV3Keys();
      expect(prisma.storeWechatPayConfig.findMany).toHaveBeenCalledTimes(1);

      await service.updateWechatPayConfig(user, {
        mchId: '1234567890',
        mchName: '纯利小店',
        apiV3Key: 'secret',
      });

      await service.listAllApiV3Keys();
      expect(prisma.storeWechatPayConfig.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('listAllApiV3Keys', () => {
    it('缓存命中时不重复查库，forceRefresh 强制回源', async () => {
      prisma.storeWechatPayConfig.findMany.mockResolvedValue([
        { apiV3KeyEnc: 'enc(k1)', storeId: 9 },
      ]);
      const service = createService();

      expect(await service.listAllApiV3Keys()).toEqual(['k1']);
      expect(await service.listAllApiV3Keys()).toEqual(['k1']);
      expect(prisma.storeWechatPayConfig.findMany).toHaveBeenCalledTimes(1);

      expect(await service.listAllApiV3Keys(true)).toEqual(['k1']);
      expect(prisma.storeWechatPayConfig.findMany).toHaveBeenCalledTimes(2);
    });

    it('解密失败的密文返回 null，不把密文当密钥返回', async () => {
      prisma.storeWechatPayConfig.findMany.mockResolvedValue([
        { apiV3KeyEnc: FAKE_CIPHERTEXT, storeId: 9 },
      ]);
      encryption.decrypt.mockImplementation(() => {
        throw new Error('Unsupported state or unable to authenticate data');
      });

      await expect(createService().listAllApiV3Keys(true)).resolves.toEqual([]);
    });

    it('历史明文数据按原值返回，保持迁移期兼容', async () => {
      prisma.storeWechatPayConfig.findMany.mockResolvedValue([
        { apiV3KeyEnc: 'legacy-plain-key', storeId: 9 },
      ]);
      encryption.decrypt.mockImplementation(() => {
        throw new Error('Invalid encrypted format');
      });

      await expect(createService().listAllApiV3Keys(true)).resolves.toEqual([
        'legacy-plain-key',
      ]);
    });

    it('去重相同密钥', async () => {
      prisma.storeWechatPayConfig.findMany.mockResolvedValue([
        { apiV3KeyEnc: 'enc(k1)', storeId: 9 },
        { apiV3KeyEnc: 'enc(k1)', storeId: 10 },
        { apiV3KeyEnc: 'enc(k2)', storeId: 11 },
      ]);

      await expect(createService().listAllApiV3Keys(true)).resolves.toEqual([
        'k1',
        'k2',
      ]);
    });
  });

  describe('getApiV3KeyByMchId', () => {
    it('商户号唯一时返回对应密钥', async () => {
      prisma.storeWechatPayConfig.findMany.mockResolvedValue([
        { apiV3KeyEnc: 'enc(k1)', storeId: 9 },
      ]);

      await expect(
        createService().getApiV3KeyByMchId('1234567890'),
      ).resolves.toBe('k1');
    });

    it('多门店共用同一商户号时判定为歧义并返回 null', async () => {
      prisma.storeWechatPayConfig.findMany.mockResolvedValue([
        { apiV3KeyEnc: 'enc(k1)', storeId: 9 },
        { apiV3KeyEnc: 'enc(k2)', storeId: 10 },
      ]);

      // 不能任取「最新一条」，否则后配置者会顶掉先配置者的密钥
      await expect(
        createService().getApiV3KeyByMchId('1234567890'),
      ).resolves.toBeNull();
    });

    it('无匹配商户号时返回 null', async () => {
      prisma.storeWechatPayConfig.findMany.mockResolvedValue([]);

      await expect(
        createService().getApiV3KeyByMchId('0000000000'),
      ).resolves.toBeNull();
    });
  });

  describe('getWechatPayConfig', () => {
    it('未配置时返回 configured:false 而非抛 404', async () => {
      prisma.storeWechatPayConfig.findUnique.mockResolvedValue(null);

      await expect(createService().getWechatPayConfig(user)).resolves.toEqual({
        configured: false,
      });
    });
  });

  describe('服务商模式下的配置与绑定校验', () => {
    beforeEach(() => {
      configState['wechat.partner.enabled'] = true;
    });

    it('首次配置不要求 APIv3 密钥（子商户在微信侧没有密钥）', async () => {
      prisma.storeWechatPayConfig.findUnique.mockResolvedValue(null);
      prisma.storeWechatPayConfig.upsert.mockResolvedValue({
        mchId: '1234567890',
        mchName: '纯利小店',
        apiV3KeyEnc: '',
        subMchId: '1234567890',
        bindStatus: 'pending',
        bindCheckedAt: null,
        bindFailReason: null,
        configuredAt: new Date('2026-10-29T12:00:00.000Z'),
      });

      const result = await createService().updateWechatPayConfig(user, {
        mchId: '1234567890',
        mchName: '纯利小店',
      });

      // 保存成功但未校验 ⇒ 不能算「已配置」，否则会出现配了却收不到钱的静默故障
      expect(result.configured).toBe(false);
      expect(result.bindStatus).toBe('pending');
    });

    it('改动商户号会作废上一次的校验结论', async () => {
      prisma.storeWechatPayConfig.findUnique.mockResolvedValue({
        mchId: '1234567890',
        mchName: '纯利小店',
        apiV3KeyEnc: '',
        subMchId: '1234567890',
        bindStatus: 'verified',
        bindCheckedAt: new Date(),
        bindFailReason: null,
        configuredAt: new Date(),
      });

      await createService().updateWechatPayConfig(user, {
        mchId: '1234567891',
      });

      const [args] = prisma.storeWechatPayConfig.upsert.mock.calls[0];
      expect(args.update).toMatchObject({
        mchId: '1234567891',
        subMchId: '1234567891',
        bindStatus: 'pending',
        bindCheckedAt: null,
        bindFailReason: null,
      });
    });

    it('校验通过：configured 变 true 且回传 bindStatus', async () => {
      bindService.verifyAndPersist.mockResolvedValue({
        outcome: 'verified',
        record: {
          mchId: '1234567890',
          mchName: '纯利小店',
          apiV3KeyEnc: '',
          subMchId: '1234567890',
          bindStatus: 'verified',
          bindCheckedAt: new Date('2026-10-29T12:00:00.000Z'),
          bindFailReason: null,
          configuredAt: new Date(),
        },
      });

      const result = await createService().verifyWechatPayBind(user);

      expect(result.configured).toBe(true);
      expect(result.bindStatus).toBe('verified');
      // 校验目标由 JWT 上下文决定，不接受外部传入的门店 ID（越权边界在 bind 服务内）
      expect(bindService.verifyAndPersist).toHaveBeenCalledWith(user);
    });

    it('校验失败：回传 failed 与失败原因，configured 仍为 false', async () => {
      bindService.verifyAndPersist.mockResolvedValue({
        outcome: 'failed',
        record: {
          mchId: '1234567890',
          mchName: '纯利小店',
          apiV3KeyEnc: '',
          subMchId: '1234567890',
          bindStatus: 'failed',
          bindCheckedAt: new Date('2026-10-29T12:00:00.000Z'),
          bindFailReason: '该子商户号尚未与本平台服务商绑定或未授权',
          configuredAt: new Date(),
        },
      });

      const result = await createService().verifyWechatPayBind(user);

      expect(result.configured).toBe(false);
      expect(result.bindStatus).toBe('failed');
      expect(result.bindFailReason).toContain('未授权');
    });

    it('未保存子商户号就校验时由 bind 服务拒绝，不透出内部细节', async () => {
      bindService.verifyAndPersist.mockRejectedValue(
        new BadRequestException('请先保存子商户号，再发起绑定校验'),
      );

      await expect(createService().verifyWechatPayBind(user)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
