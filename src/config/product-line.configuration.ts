import {
  isTestModeDefaultEnvironment,
  parseIntValue,
  parseStringList,
} from './env.utils';

/**
 * 三条产品线的业务配置。
 *
 * - `pulse`：平台 / 运营端
 * - `profit`：商家 / 老板端
 * - `club`：C 端会员端
 *
 * 三条线各自持有独立的支付模式开关与 dev token，禁止跨线复用：
 * 一处放松不代表另一条链路可以跳过真实扣款。
 */

/** `pulse` 配置块：平台运营端。 */
export interface PulseConfig {
  devAccountEmails: string[];
}

/** `profit` 配置块：商家 / 老板端。 */
export interface ProfitConfig {
  /** 是否默认允许「跳过真实扣款、订单直接生效」 */
  manualPaidEnabled: boolean;
  /** 是否允许通过 dev-only 接口在运行期切换支付模式（test / live） */
  paymentModeSwitchEnabled: boolean;
  /** dev-only 支付模式开关接口的访问令牌 */
  paymentModeDevToken: string;
  /** 平台收款的统一回调地址（会员开通 / 新客额度充值共用） */
  wechatPayNotifyUrl: string;
}

/** `club` 配置块：C 端会员端。 */
export interface ClubConfig {
  wechatCallbackSecret: string;
  wechatCallbackMaxAgeSeconds: number;
  /** true 表示默认处于测试支付模式（允许跳过微信扣款、由 confirm-paid 直接置为已支付） */
  manualConfirmPaidEnabled: boolean;
  /** 是否允许通过 dev-only 开关接口在运行期切换支付模式 */
  paymentModeSwitchEnabled: boolean;
  /** dev-only 支付模式开关接口的访问令牌 */
  paymentModeDevToken: string;
  /** 邀请二维码使用的俱乐部公共域名（长期稳定、公网可达） */
  publicBaseUrl: string;
  /** 邀请二维码稳定入口路径前缀，默认 /i */
  storeInviteQrEntryPath: string;
  /** 扫码点餐桌码 / 空间码使用的公共域名 */
  scanQrBaseUrl: string;
}

/** 解析 `pulse` 配置块。 */
export function resolvePulseConfig(): PulseConfig {
  return {
    devAccountEmails: parseStringList(process.env.PULSE_DEV_ACCOUNT_EMAILS),
  };
}

/** 解析 `profit` 配置块。 */
export function resolveProfitConfig(): ProfitConfig {
  return {
    /**
     * 商家端（purelyProfit）是否默认允许「跳过真实扣款、订单直接生效」。
     *
     * 这是配套的技术方案开关，不是业务开关：历史上有几条链路（平台会员开通/续费、
     * 新客额度充值）没有接入真实支付，服务端直接把订单置为已生效。
     * 接入真实支付后，这个值应该在各环境都设为 false（= 真实模式）。
     *
     * 默认值策略与 club 侧保持一致（fail-closed）：仅 `development` / `test`
     * 两个环境默认 true；staging / pre / 预发等未列入白名单的环境默认 false，
     * 避免「NODE_ENV 不叫 production」就自动放开免费开通会员 / 免费充值额度。
     * 生产环境无论环境变量如何配置都会被启动校验强制拦下。
     * 对应环境变量：PROFIT_MANUAL_PAID_ENABLED
     */
    manualPaidEnabled:
      (process.env.PROFIT_MANUAL_PAID_ENABLED ??
        (isTestModeDefaultEnvironment() ? 'true' : 'false')) === 'true',
    /**
     * 是否允许通过 dev-only 接口在运行期切换支付模式（test / live）。
     * 默认值策略与上一项一致（仅 development / test 默认开启）。
     * 生产环境无论环境变量如何配置都强制禁用。
     * 对应环境变量：PROFIT_PAYMENT_MODE_SWITCH_ENABLED
     */
    paymentModeSwitchEnabled:
      (process.env.PROFIT_PAYMENT_MODE_SWITCH_ENABLED ??
        (isTestModeDefaultEnvironment() ? 'true' : 'false')) === 'true',
    /**
     * dev-only 支付模式开关接口的访问令牌。
     * 未配置时切换请求一律拒绝，防止测试环境公网可达时被任意切到真实扣款。
     * 对应环境变量：PROFIT_PAYMENT_MODE_DEV_TOKEN
     */
    paymentModeDevToken: process.env.PROFIT_PAYMENT_MODE_DEV_TOKEN ?? '',

    /**
     * 平台收款的**统一**回调地址（`POST /profit/payments/wechat/callback`）。
     *
     * 会员开通 / 新客额度充值两条链路共用这个入口：回调里按支付单号反查
     * `platform_payment_orders.bizType` 再分发，省掉一份重复的验签解密实现。
     *
     * ⚠️ 短信钱包充值**不在其中**：它的订单落在 `sms_recharge_orders`（SM 前缀），
     * 统一回调按 platform_payment_orders 反查会查不到。短信链路必须配
     * `SMS_WECHAT_PAY_NOTIFY_URL`（/api/marketing/sms/wechat/callback），两者不可混用。
     *
     * 必须是公网可达 HTTPS。
     * 对应环境变量：PROFIT_WECHAT_PAY_NOTIFY_URL
     * 示例：https://api.yourdomain.com/api/profit/payments/wechat/callback
     */
    wechatPayNotifyUrl: process.env.PROFIT_WECHAT_PAY_NOTIFY_URL ?? '',
  };
}

/** 解析 `club` 配置块。 */
export function resolveClubConfig(): ClubConfig {
  return {
    wechatCallbackSecret:
      process.env.CLUB_WECHAT_CALLBACK_SECRET ?? 'club_wechat_callback_secret',
    wechatCallbackMaxAgeSeconds: parseIntValue(
      process.env.CLUB_WECHAT_CALLBACK_MAX_AGE_SECONDS,
      300,
    ),
    /**
     * 开发态兜底开关：为 true 表示默认处于**测试支付模式**（允许跳过微信扣款、
     * 由 confirm-paid 直接把订单置为已支付）。
     *
     * 默认值只在 `development` / `test` 两个环境为 true；
     * staging / pre / 预发等非白名单环境默认 false（fail-closed），
     * 避免「NODE_ENV 不叫 production」就自动放开免费下单。
     * 生产环境无论环境变量如何配置都会被启动校验强制拦下
     * （`bootstrap/production-config.utils.ts`）。
     * 对应环境变量：CLUB_MANUAL_CONFIRM_PAID_ENABLED
     */
    manualConfirmPaidEnabled:
      (process.env.CLUB_MANUAL_CONFIRM_PAID_ENABLED ??
        (isTestModeDefaultEnvironment() ? 'true' : 'false')) === 'true',
    /**
     * 是否允许通过 dev-only 开关接口在运行期切换支付模式（test / live）。
     * 默认值策略与 manualConfirmPaidEnabled 一致：仅 development / test 默认开启。
     * 生产环境无论环境变量如何配置都强制禁用。
     * 对应环境变量：CLUB_PAYMENT_MODE_SWITCH_ENABLED
     */
    paymentModeSwitchEnabled:
      (process.env.CLUB_PAYMENT_MODE_SWITCH_ENABLED ??
        (isTestModeDefaultEnvironment() ? 'true' : 'false')) === 'true',
    /**
     * dev-only 支付模式开关接口的访问令牌。
     * 未配置时切换请求一律拒绝，避免测试环境公网可达时被任意切到真实扣款。
     * 前端需通过构建期注入的同值令牌携带 `x-payment-dev-token` 请求头。
     * 对应环境变量：CLUB_PAYMENT_MODE_DEV_TOKEN
     */
    paymentModeDevToken: process.env.CLUB_PAYMENT_MODE_DEV_TOKEN ?? '',
    /**
     * 邀请二维码使用的俱乐部公共域名（长期稳定、公网可达、不随环境/部署变动）。
     * 未配置时二维码回退为裸邀请码（legacy）格式，避免把 localhost / 内网地址写入二维码。
     * 对应环境变量：CLUB_PUBLIC_BASE_URL
     * 示例：https://club.purelyprofit.com
     *
     * ⚠️ 上线提醒：生产部署前必须将该值替换为真实公网域名。
     * 本机联调允许填写 http://localhost:3000（生成形如 http://localhost:3000/i/v1/{code}
     * 的二维码），但生产环境（NODE_ENV=production）下：
     * - localhost / 内网 IP / 私有网段会被 sanitize 拒绝，二维码自动回退 legacy 裸码格式；
     * - 渠道二维码创建接口（POST /marketing/invite-code/issues）会直接报错拒绝创建；
     * - 严禁将 localhost、内网地址、临时 preview URL 写进已发行二维码（会导致已印刷物料失效）。
     *
     * ⚠️ 该域名一经印刷即视为永久资产（只增不换）：换域名、备案注销、微信规则被删
     * 都会让全部已印进店码同时失效，且服务端无法补救。启动期由
     * `reportStoreInviteQrBaseUrlStatus` 播报状态（未配置 warn、被 sanitize 拒绝 error）。
     */
    publicBaseUrl: process.env.CLUB_PUBLIC_BASE_URL ?? '',
    /**
     * 邀请二维码稳定入口路径前缀，默认 /i，最终二维码形如
     * {publicBaseUrl}/i/v1/{inviteCode}。
     * 对应环境变量：CLUB_STORE_INVITE_QR_ENTRY_PATH
     *
     * ⚠️ 与 publicBaseUrl 一样是**永久资产**：入口段被烧进每一张已印刷的进店码，
     * 改动后旧物料指向的路径不再被生成侧 / 解析侧任何一方承认（服务端
     * `V1_PATH_PATTERN` 与前端 `SCAN_PATH_KINDS.storeInvite` 都只认 `i` / `invite`），
     * 且**不会报错**——只能等顾客扫不出来才发现。
     *
     * 因此只接受 `STORE_INVITE_QR_ENTRY_SEGMENTS`（`i` / `invite`）白名单内的取值，
     * 其它取值会被拒绝并回退 `i`、同时记 error；新增入口段必须前后端与微信
     * 公众平台规则一起改，并由 `npm run scan:qr:contract:check` 对齐两侧常量。
     */
    storeInviteQrEntryPath: process.env.CLUB_STORE_INVITE_QR_ENTRY_PATH ?? '/i',
    /**
     * 扫码点餐桌码 / 空间码使用的公共域名。
     * 对应环境变量：SCAN_QR_BASE_URL
     * 示例：https://scan.purelyprofit.com
     *
     * 二维码形如 {scanQrBaseUrl}/t/{qrToken}（桌码）、{scanQrBaseUrl}/p/{spaceToken}（空间码）。
     *
     * ⚠️ 刻意与邀请二维码的 CLUB_PUBLIC_BASE_URL 分开配置：
     * 「扫普通链接二维码打开小程序」按「域名 + 路径前缀」下发规则，共用域名时
     * 规则很容易把 {base}/i/... 一并唤起小程序，导致邀请二维码无法再落地到 H5。
     *
     * ⚠️ 未配置时二维码回退历史格式（桌码裸 token、空间码 purelyclub:// 自定义协议），
     * 即本项配置缺失不会改变现有行为，也不会让已印刷物料失效。
     *
     * 生产环境（NODE_ENV=production）下 localhost / 内网 IP / 私有网段会被 sanitize
     * 拒绝并自动回退，避免把不可达地址写进物料。
     *
     * ⚠️ 该域名一经印刷即视为永久资产（只增不换）：换域名、备案注销、微信规则被删
     * 都会让全部已印物料同时失效，且服务端无法补救（微信按 URL 文本前缀匹配规则，
     * 不会 fetch 旧域名做跳转）。换域名时必须保留旧域名解析与旧规则。
     */
    scanQrBaseUrl: process.env.SCAN_QR_BASE_URL ?? '',
  };
}
