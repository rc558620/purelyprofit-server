import { extractTableQrToken } from './table-qr-token.utils';

/**
 * 桌码 token 提取测试（服务端兜底）。
 *
 * 已印刷物料不能因「某个入口忘了提取」而失效，所以三种载荷形态都必须解出同一个
 * token，且对「前端已提取过的裸 token」必须幂等。
 */
describe('extractTableQrToken', () => {
  /** 服务端生成的桌码 token 形态：32 字节 base64url，43 位 */
  const TOKEN = 'NuSUjOX2ZBWZrLNx4C-nU-lCVKTAsL3xzLJNOkLlZvM';

  it('路径式 URL（{base}/t/{token}）能解出 token', () => {
    expect(
      extractTableQrToken(`https://scan.purelyprofit.com/t/${TOKEN}`),
    ).toBe(TOKEN);
  });

  it('query 式 URL（{base}/t?token={token}）能解出 token', () => {
    expect(
      extractTableQrToken(`https://scan.purelyprofit.com/t?token=${TOKEN}`),
    ).toBe(TOKEN);
  });

  it('历史裸 token 原样参与匹配', () => {
    expect(extractTableQrToken(TOKEN)).toBe(TOKEN);
  });

  it('前端已提取过的裸 token 不会被重复处理（提取幂等）', () => {
    expect(extractTableQrToken(`  ${TOKEN}  `)).toBe(TOKEN);
  });

  it('路径末段不是 token 形态时按裸 token 处理，不把路径段 t 当成 token', () => {
    expect(extractTableQrToken('https://scan.purelyprofit.com/t')).toBe(
      'https://scan.purelyprofit.com/t',
    );
  });

  it('空值原样返回', () => {
    expect(extractTableQrToken('   ')).toBe('');
  });
});
