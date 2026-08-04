import {
  buildStoreInviteQrPayload,
  resolveStoreInviteQrPayload,
  STORE_INVITE_QR_PROTOCOL_LEGACY,
  STORE_INVITE_QR_PROTOCOL_V1,
} from './store-invite-code-qr.utils';

describe('store-invite-code-qr.utils', () => {
  describe('buildStoreInviteQrPayload', () => {
    it('配置公共域名时生成 v1 稳定 URL 载荷', () => {
      expect(
        buildStoreInviteQrPayload('ab23cd45', {
          baseUrl: 'https://club.purelyprofit.com',
        }),
      ).toBe('https://club.purelyprofit.com/i/v1/AB23CD45');
    });

    it('支持自定义入口路径', () => {
      expect(
        buildStoreInviteQrPayload('AB23CD45', {
          baseUrl: 'https://club.purelyprofit.com/',
          entryPath: '/invite',
        }),
      ).toBe('https://club.purelyprofit.com/invite/v1/AB23CD45');
    });

    it('未配置公共域名时回退为裸邀请码（legacy）', () => {
      expect(buildStoreInviteQrPayload('AB23CD45', {})).toBe('AB23CD45');
      expect(
        buildStoreInviteQrPayload('AB23CD45', { baseUrl: '' }),
      ).toBe('AB23CD45');
    });

    it('禁止私有网络地址时回退 legacy（生产环境安全策略）', () => {
      expect(
        buildStoreInviteQrPayload('AB23CD45', {
          baseUrl: 'http://localhost:3000',
          allowPrivateNetwork: false,
        }),
      ).toBe('AB23CD45');
      expect(
        buildStoreInviteQrPayload('AB23CD45', {
          baseUrl: 'http://192.168.1.10',
          allowPrivateNetwork: false,
        }),
      ).toBe('AB23CD45');
    });

    it('非法 URL 协议（非 http/https）时回退 legacy', () => {
      expect(
        buildStoreInviteQrPayload('AB23CD45', { baseUrl: 'localhost' }),
      ).toBe('AB23CD45');
      expect(
        buildStoreInviteQrPayload('AB23CD45', { baseUrl: 'ftp://x.com' }),
      ).toBe('AB23CD45');
    });

    it('本机联调环境放行 localhost（allowPrivateNetwork 默认开启，生产除外）', () => {
      expect(
        buildStoreInviteQrPayload('AB23CD45', {
          baseUrl: 'http://localhost:3000',
          allowPrivateNetwork: true,
        }),
      ).toBe('http://localhost:3000/i/v1/AB23CD45');
    });

    it('非法邀请码返回空串', () => {
      expect(
        buildStoreInviteQrPayload('not-a-code', {
          baseUrl: 'https://club.purelyprofit.com',
        }),
      ).toBe('');
    });
  });

  describe('resolveStoreInviteQrPayload', () => {
    it('识别 v1 路径式 URL', () => {
      expect(
        resolveStoreInviteQrPayload(
          'https://club.purelyprofit.com/i/v1/AB23CD45',
        ),
      ).toEqual({
        kind: 'recognized',
        protocolVersion: STORE_INVITE_QR_PROTOCOL_V1,
        inviteCode: 'AB23CD45',
        issueToken: null,
        raw: 'https://club.purelyprofit.com/i/v1/AB23CD45',
      });
    });

    it('识别 v1 路径式 URL 携带渠道 token（?t=xxx）', () => {
      expect(
        resolveStoreInviteQrPayload(
          'https://club.purelyprofit.com/i/v1/AB23CD45?t=abc12345-6789-4def-0123-456789abcdef',
        ),
      ).toEqual({
        kind: 'recognized',
        protocolVersion: STORE_INVITE_QR_PROTOCOL_V1,
        inviteCode: 'AB23CD45',
        issueToken: 'abc12345-6789-4def-0123-456789abcdef',
        raw: 'https://club.purelyprofit.com/i/v1/AB23CD45?t=abc12345-6789-4def-0123-456789abcdef',
      });
    });

    it('识别 v1 的 /invite 别名路径', () => {
      expect(
        resolveStoreInviteQrPayload(
          'https://club.purelyprofit.com/invite/v1/ab23cd45',
        ),
      ).toEqual({
        kind: 'recognized',
        protocolVersion: STORE_INVITE_QR_PROTOCOL_V1,
        inviteCode: 'AB23CD45',
        issueToken: null,
        raw: 'https://club.purelyprofit.com/invite/v1/ab23cd45',
      });
    });

    it('未知协议版本返回 unsupported_version', () => {
      expect(
        resolveStoreInviteQrPayload(
          'https://club.purelyprofit.com/i/v999/AB23CD45',
        ),
      ).toEqual({
        kind: 'unsupported_version',
        protocolVersion: 'v999',
        raw: 'https://club.purelyprofit.com/i/v999/AB23CD45',
      });
    });

    it('识别裸邀请码（legacy）', () => {
      expect(resolveStoreInviteQrPayload('AB23CD45')).toEqual({
        kind: 'recognized',
        protocolVersion: STORE_INVITE_QR_PROTOCOL_LEGACY,
        inviteCode: 'AB23CD45',
        issueToken: null,
        raw: 'AB23CD45',
      });
    });

    it('识别历史 query 参数 inviteCode / code / invite_code（legacy）', () => {
      expect(
        resolveStoreInviteQrPayload(
          'https://club.example.com/page?inviteCode=AB23CD45',
        ),
      ).toEqual({
        kind: 'recognized',
        protocolVersion: STORE_INVITE_QR_PROTOCOL_LEGACY,
        inviteCode: 'AB23CD45',
        issueToken: null,
        raw: 'https://club.example.com/page?inviteCode=AB23CD45',
      });
      expect(
        resolveStoreInviteQrPayload(
          'https://club.example.com/page?code=XY56ZW78',
        ),
      ).toEqual(expect.objectContaining({ inviteCode: 'XY56ZW78' }));
      expect(
        resolveStoreInviteQrPayload(
          'https://club.example.com/page?invite_code=XY56ZW78',
        ),
      ).toEqual(expect.objectContaining({ inviteCode: 'XY56ZW78' }));
    });

    it('识别 URL 路径末段邀请码（legacy）', () => {
      expect(
        resolveStoreInviteQrPayload(
          'https://club.example.com/pages/storeSelect/index/AB23CD45',
        ),
      ).toEqual(expect.objectContaining({ inviteCode: 'AB23CD45' }));
    });

    it('非邀请码内容返回 unrecognized', () => {
      expect(resolveStoreInviteQrPayload('not-a-store-code')).toEqual({
        kind: 'unrecognized',
        raw: 'not-a-store-code',
      });
      expect(resolveStoreInviteQrPayload('')).toEqual({
        kind: 'unrecognized',
        raw: '',
      });
    });

    it('扫码点餐桌码 URL（?token=）不误判为邀请码', () => {
      expect(
        resolveStoreInviteQrPayload(
          'https://club.example.com/order?token=abc123xyz',
        ).kind,
      ).toBe('unrecognized');
    });

    it('超长伪邀请码不识别', () => {
      expect(
        resolveStoreInviteQrPayload('A'.repeat(33)).kind,
      ).toBe('unrecognized');
    });
  });
});
