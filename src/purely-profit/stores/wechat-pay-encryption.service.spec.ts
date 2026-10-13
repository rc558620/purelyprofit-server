import { createDecipheriv } from 'node:crypto';
import { WechatPayEncryptionService } from './wechat-pay-encryption.service';

describe('WechatPayEncryptionService', () => {
  const createService = (secret: string | undefined): WechatPayEncryptionService => {
    const config = { get: jest.fn(() => secret) };
    return new WechatPayEncryptionService(config as never);
  };

  it('未配置密钥时不可用，且调用 encrypt 报错（不阻塞启动）', () => {
    const service = createService(undefined);

    expect(service.isAvailable).toBe(false);
    expect(() => service.encrypt('plain')).toThrow();
  });

  it('32 字节明文密钥沿用历史派生方式，保持与已存密文兼容', () => {
    const secret = '0123456789abcdef0123456789abcdef';
    const service = createService(secret);

    const [iv, tag, ciphertext] = service
      .encrypt('hello')
      .split(':')
      .map((part) => Buffer.from(part, 'base64'));

    // 手工用「原始 32 字节」解密，验证未引入新的派生逻辑
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(secret, 'utf8'),
      iv,
    );
    decipher.setAuthTag(tag);

    expect(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        'utf8',
      ),
    ).toBe('hello');
  });

  it('64 位十六进制密钥可加解密', () => {
    const service = createService(
      'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    );

    expect(service.isAvailable).toBe(true);
    expect(service.decrypt(service.encrypt('api-v3-key'))).toBe('api-v3-key');
  });

  it('非 32 字节密钥改用 scrypt 派生而非补零，且加解密自洽', () => {
    const service = createService('short-secret');

    expect(service.isAvailable).toBe(true);
    expect(service.decrypt(service.encrypt('api-v3-key'))).toBe('api-v3-key');
  });

  it('每次加密使用新 IV，相同明文产出不同密文', () => {
    const service = createService('0123456789abcdef0123456789abcdef');

    expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
  });

  it('三段密文格式错误时解密抛错', () => {
    const service = createService('0123456789abcdef0123456789abcdef');

    expect(() => service.decrypt('not-a-valid-payload')).toThrow(
      'Invalid encrypted format',
    );
  });
});
