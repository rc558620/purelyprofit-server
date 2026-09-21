import {
  buildScanOrderingTableQrPayload,
  buildSpaceQrPayload,
  SCAN_QR_SPACE_PATH,
  SCAN_QR_TABLE_PATH,
} from './scan-qr-payload.utils';

/** 服务端桌码 token 形态：randomBytes(32).toString('base64url')，43 位。 */
const TABLE_TOKEN = 'NuSUjOX2ZBWZrLNx4C-nU-lCVKTAsL3xzLJNOkLlZvM';
/** 服务端空间码 token 形态：randomUUID()。 */
const SPACE_TOKEN = '7f1c2f52-7a1f-4a1e-9f2a-3f0a1b2c3d4e';
const BASE_URL = 'https://scan.purelyprofit.com';

describe('scan-qr-payload.utils', () => {
  describe('路径契约', () => {
    it('路径段必须与前端 scanPayload.ts 的 SCAN_PATH_KINDS 一致', () => {
      // 前后端各持一份常量，改动任一侧都会让前端无法按路径粗分扫码类型
      expect(SCAN_QR_TABLE_PATH).toBe('t');
      expect(SCAN_QR_SPACE_PATH).toBe('p');
    });
  });

  describe('buildScanOrderingTableQrPayload', () => {
    it('配置域名时生成 /t/{token} 稳定 URL', () => {
      expect(
        buildScanOrderingTableQrPayload(TABLE_TOKEN, { baseUrl: BASE_URL }),
      ).toBe(`${BASE_URL}/t/${TABLE_TOKEN}`);
    });

    it('域名结尾多余斜杠被归一化，不产生双斜杠', () => {
      expect(
        buildScanOrderingTableQrPayload(TABLE_TOKEN, {
          baseUrl: `${BASE_URL}/`,
        }),
      ).toBe(`${BASE_URL}/t/${TABLE_TOKEN}`);
    });

    it('未配置域名时回退裸 token（已印刷桌码行为不变）', () => {
      expect(buildScanOrderingTableQrPayload(TABLE_TOKEN)).toBe(TABLE_TOKEN);
      expect(
        buildScanOrderingTableQrPayload(TABLE_TOKEN, { baseUrl: '' }),
      ).toBe(TABLE_TOKEN);
    });

    it('禁止私有网络时回退裸 token（生产环境安全策略）', () => {
      expect(
        buildScanOrderingTableQrPayload(TABLE_TOKEN, {
          baseUrl: 'http://localhost:3000',
          allowPrivateNetwork: false,
        }),
      ).toBe(TABLE_TOKEN);
      expect(
        buildScanOrderingTableQrPayload(TABLE_TOKEN, {
          baseUrl: 'http://192.168.1.10',
          allowPrivateNetwork: false,
        }),
      ).toBe(TABLE_TOKEN);
    });

    it('本机联调放行 localhost，生成可扫的本地 URL', () => {
      expect(
        buildScanOrderingTableQrPayload(TABLE_TOKEN, {
          baseUrl: 'http://localhost:3000',
          allowPrivateNetwork: true,
        }),
      ).toBe(`http://localhost:3000/t/${TABLE_TOKEN}`);
    });

    it('非法协议（非 http/https）回退裸 token', () => {
      expect(
        buildScanOrderingTableQrPayload(TABLE_TOKEN, {
          baseUrl: 'ftp://scan.purelyprofit.com',
        }),
      ).toBe(TABLE_TOKEN);
      expect(
        buildScanOrderingTableQrPayload(TABLE_TOKEN, { baseUrl: 'scan.purelyprofit.com' }),
      ).toBe(TABLE_TOKEN);
    });

    it('非法 token 返回空串（token 由本服务生成，空值应视为内部错误）', () => {
      expect(
        buildScanOrderingTableQrPayload('short', { baseUrl: BASE_URL }),
      ).toBe('');
      expect(
        buildScanOrderingTableQrPayload('has space in token', {
          baseUrl: BASE_URL,
        }),
      ).toBe('');
    });
  });

  describe('buildSpaceQrPayload', () => {
    it('配置域名时生成 /p/{token} 稳定 URL', () => {
      expect(buildSpaceQrPayload(SPACE_TOKEN, { baseUrl: BASE_URL })).toBe(
        `${BASE_URL}/p/${SPACE_TOKEN}`,
      );
    });

    it('未配置域名时回退历史自定义协议，保证旧物料仍可扫', () => {
      expect(buildSpaceQrPayload(SPACE_TOKEN)).toBe(
        `purelyclub://space-scan?token=${SPACE_TOKEN}`,
      );
    });

    it('生产环境拒绝 localhost 时回退历史自定义协议', () => {
      expect(
        buildSpaceQrPayload(SPACE_TOKEN, {
          baseUrl: 'http://localhost:3000',
          allowPrivateNetwork: false,
        }),
      ).toBe(`purelyclub://space-scan?token=${SPACE_TOKEN}`);
    });

    it('非法 token 返回空串', () => {
      expect(buildSpaceQrPayload('nope', { baseUrl: BASE_URL })).toBe('');
    });
  });

  describe('与前端解析层的往返一致性', () => {
    it('生成的桌码 URL 可被按路径末段提取出原 token', () => {
      const payload = buildScanOrderingTableQrPayload(TABLE_TOKEN, {
        baseUrl: BASE_URL,
      });
      // 前端 extractTableToken 取的是路径末段（后端 extractQrToken 只认 ?token=，
      // 所以路径式 URL 必须由前端提取，这里锁住「可提取」这一前提）
      const lastSegment = payload.split('/').filter(Boolean).at(-1);
      expect(lastSegment).toBe(TABLE_TOKEN);
    });

    it('生成的空间码 URL 可被按路径末段提取出原 token', () => {
      const payload = buildSpaceQrPayload(SPACE_TOKEN, { baseUrl: BASE_URL });
      const lastSegment = payload.split('/').filter(Boolean).at(-1);
      expect(lastSegment).toBe(SPACE_TOKEN);
    });
  });
});
