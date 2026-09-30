// 客存（B 端）业务常量：异常文案、分页参数、临期阈值与默认单位选项
/** 客存单不存在 */
export const CUSTODY_ORDER_NOT_FOUND_MESSAGE =
  '存单不存在或已作废，请刷新列表后重试';

/** 门店下找不到对应会员（一期强制会员才能客存） */
export const CUSTODY_MEMBER_NOT_FOUND_MESSAGE =
  '当前门店下找不到该手机号对应的会员，请先确认会员信息';

/** 门店未开启客存 */
export const CUSTODY_DISABLED_MESSAGE =
  '当前门店未开启客存功能，请先在门店设置中开启';

/** 确认码无效或已过期 */
export const CUSTODY_CONFIRM_CODE_INVALID_MESSAGE =
  '确认码无效或已过期，请让店员重新发起存入';

/** 确认码连续错误锁定 */
export const CUSTODY_CONFIRM_CODE_LOCKED_MESSAGE =
  '确认码错误次数过多，请 10 分钟后重试';

/** 取件码无效或已过期 */
export const CUSTODY_PICKUP_CODE_INVALID_MESSAGE =
  '取件码无效或已过期，请让客户重新生成取件码';

/** 核销令牌无效或已过期 */
export const CUSTODY_VERIFY_TOKEN_INVALID_MESSAGE =
  '核销信息已过期，请重新输入取件码';

/** 取出数量不合法 */
export const CUSTODY_PICKUP_QTY_INVALID_MESSAGE =
  '取出数量必须大于 0 且不超过剩余数量';

/** 存单状态不允许取出 */
export const CUSTODY_PICKUP_STATUS_INVALID_MESSAGE =
  '当前存单状态不支持取出，仅在地皆可核销';

/** 未核对取件人身份（P0 防冒领，前端必须显式勾选） */
export const CUSTODY_IDENTITY_UNCHECKED_MESSAGE =
  '请先核对取件人姓名与手机号后四位并勾选确认后再取出';

/** 手机号后四位与会员不符（高风险门店二次校验） */
export const CUSTODY_PHONE_SUFFIX_INVALID_MESSAGE =
  '手机号后四位与会员不符，请让会员出示本人手机号核对';

/** 手机号后四位必填（门店已开启取出核验） */
export const CUSTODY_PHONE_SUFFIX_REQUIRED_MESSAGE =
  '该门店需核对会员手机号后四位，请填写后重试';

/** 取出核验触发原因：手机号后四位校验通过 */
export const CUSTODY_PHONE_SUFFIX_VERIFIED_REASON_STORE = '门店强制核验';

/** 取出核验触发原因：商品单价达到配置阈值 */
export const CUSTODY_PHONE_SUFFIX_VERIFIED_REASON_THRESHOLD = '单价达阈值';

/** 连续输错确认码被锁定（C 端会员侧） */
export const CUSTODY_CONFIRM_CODE_LOCKED_CLUB_MESSAGE =
  '确认码错误次数过多，请稍后重试';

/** 重发确认码仅限待确认存单 */
export const CUSTODY_RESEND_REQUIRE_DRAFT_MESSAGE =
  '仅待客户确认的存单支持重发确认码';

/** 作废原因必填 */
export const CUSTODY_VOID_REASON_REQUIRED_MESSAGE = '作废原因不能为空';

/** 库存冻结口径下商品不存在 */
export const CUSTODY_PRODUCT_NOT_FOUND_MESSAGE =
  '当前门店下找不到该商品，请确认商品是否已上架';

/** 列表默认每页条数 */
export const CUSTODY_DEFAULT_LIMIT = 10;

/** 列表每页最大条数 */
export const CUSTODY_MAX_LIMIT = 50;

/** 取出流水默认返回条数 */
export const CUSTODY_PICKUP_RECORD_LIMIT = 50;

/** 临期阈值（天）：临近过期统计口径 */
export const CUSTODY_EXPIRING_SOON_DAYS = 7;

/** 存单号前缀 */
export const CUSTODY_ORDER_NO_PREFIX = 'CO';

/** 单次存入数量上限 */
export const CUSTODY_MAX_QTY = 9999;

/** 默认计量单位选项（门店未配置时使用） */
export const CUSTODY_DEFAULT_UNIT_OPTIONS = [
  '瓶',
  '杯',
  '份',
  '次',
  '小时',
] as const;
