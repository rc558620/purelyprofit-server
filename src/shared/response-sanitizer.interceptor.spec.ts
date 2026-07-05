import { of } from 'rxjs';
import { ResponseSanitizerInterceptor } from './response-sanitizer.interceptor';

describe('ResponseSanitizerInterceptor', () => {
  let interceptor: ResponseSanitizerInterceptor;
  const mockContext = {} as any;
  const createHandler = (data: unknown) => ({
    handle: () => of(data),
  });

  beforeEach(() => {
    interceptor = new ResponseSanitizerInterceptor();
  });

  const getResult = (data: unknown): unknown => {
    let result: unknown;
    interceptor.intercept(mockContext, createHandler(data)).subscribe((v) => {
      result = v;
    });
    return result;
  };

  it('移除嵌套对象中的 password 字段', () => {
    const data = {
      id: 1,
      name: '张三',
      user: { id: 1, name: '张三', password: 'hashed_secret' },
    };

    const result = getResult(data) as any;

    expect(result.user.password).toBeUndefined();
    expect(result.user.name).toBe('张三');
  });

  it('移除嵌套对象中的 secret/privateKey/apiKey 字段', () => {
    const data = {
      config: {
        name: 'test',
        secret: 'my-secret',
        privateKey: '-----BEGIN...',
        apiKey: 'ak_123',
      },
    };

    const result = getResult(data) as any;

    expect(result.config.secret).toBeUndefined();
    expect(result.config.privateKey).toBeUndefined();
    expect(result.config.apiKey).toBeUndefined();
    expect(result.config.name).toBe('test');
  });

  it('保留顶层 access_token 和 refresh_token', () => {
    const data = {
      access_token: 'eyJhbGci...',
      refresh_token: 'rt_abc123',
      expires_in: 604800,
      userId: 1,
    };

    const result = getResult(data) as any;

    expect(result.access_token).toBe('eyJhbGci...');
    expect(result.refresh_token).toBe('rt_abc123');
    expect(result.expires_in).toBe(604800);
    expect(result.userId).toBe(1);
  });

  it('处理数组响应', () => {
    const data = [
      { id: 1, name: '张三', password: 'secret1' },
      { id: 2, name: '李四', password: 'secret2' },
    ];

    const result = getResult(data) as any[];

    expect(result).toHaveLength(2);
    expect(result[0].password).toBeUndefined();
    expect(result[0].name).toBe('张三');
    expect(result[1].password).toBeUndefined();
    expect(result[1].name).toBe('李四');
  });

  it('处理 null 和 undefined', () => {
    expect(getResult(null)).toBeNull();
    expect(getResult(undefined)).toBeUndefined();
  });

  it('处理原始值', () => {
    expect(getResult('hello')).toBe('hello');
    expect(getResult(42)).toBe(42);
    expect(getResult(true)).toBe(true);
  });

  it('深层嵌套也能正确脱敏', () => {
    const data = {
      store: {
        owner: {
          profile: {
            password: 'deep_secret',
            name: '王五',
          },
        },
      },
    };

    const result = getResult(data) as any;

    expect(result.store.owner.profile.password).toBeUndefined();
    expect(result.store.owner.profile.name).toBe('王五');
  });

  it('hashedPassword 字段也被移除', () => {
    const data = {
      user: { id: 1, hashedPassword: 'bcrypt_hash' },
    };

    const result = getResult(data) as any;

    expect(result.user.hashedPassword).toBeUndefined();
    expect(result.user.id).toBe(1);
  });
});
