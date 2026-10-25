interface SwaggerOperationLike {
  summary?: string;
  tags?: string[];
}

interface SwaggerTagLike {
  name: string;
  description?: string;
}

interface SwaggerPathItemLike {
  get?: SwaggerOperationLike;
  post?: SwaggerOperationLike;
}

export interface SwaggerDocumentLike {
  paths?: Record<string, SwaggerPathItemLike>;
  tags?: SwaggerTagLike[];
}

/** 环境过滤所需的业务开关快照 */
export interface SwaggerEnvironmentFilterOptions {
  /** 是否允许手动确认支付（club 侧兜底接口） */
  manualConfirmPaidEnabled: boolean;
  /** club 侧 dev-only 支付模式开关是否允许出现在文档中 */
  clubPaymentModeDebugVisible: boolean;
  /** profit 侧 dev-only 支付模式开关是否允许出现在文档中 */
  profitPaymentModeDebugVisible: boolean;
}

/**
 * 全局路由前缀，与 bootstrap 中 `app.setGlobalPrefix('api')` 保持一致。
 *
 * `SwaggerModule.createDocument` 默认会把全局前缀拼进文档 key（产出
 * `/api/profit/dev/payment-mode`），而下面的路径清单写的是与 controller
 * 装饰器一致的**相对路由**。若直接按原始 key 比对，剔除会永远不命中、
 * 静默失效——所以统一先剥前缀再比较。
 */
const SWAGGER_GLOBAL_PREFIX = '/api';

const CLUB_MANUAL_CONFIRM_PAID_FALLBACK_TAG = 'Dev Only / Fallback';
const CLUB_MANUAL_CONFIRM_PAID_SWAGGER_PATHS = [
  '/club/orders/{id}/confirm-paid',
  '/club/recharge/orders/{id}/confirm-paid',
  '/club/voucher-orders/{orderNo}/confirm-paid',
  '/club/scan-ordering/orders/{orderId}/confirm-paid',
  '/club/self-ordering/orders/{orderId}/confirm-paid',
] as const;
/**
 * dev-only 支付模式开关接口路径（相对路由，不含全局前缀）。
 * 生产环境必须从文档中剔除，避免对外暴露「可以切换支付模式」的入口。
 */
const CLUB_PAYMENT_MODE_SWAGGER_PATHS = ['/club/dev/payment-mode'] as const;
/**
 * dev-only 支付模式开关接口的 Swagger 分组名。
 * 路径被剔除后该分组仍会残留在 tags 列表里，同样是「调试入口存在」的信号，需要一起清掉。
 */
const CLUB_PAYMENT_MODE_SWAGGER_TAG = 'Club / Payments · 调试';
/**
 * 商家端（purelyProfit）dev-only 支付模式开关接口路径（相对路由，不含全局前缀）。
 * 商家端的二维码与订单状态全部由后端生成，调试入口一旦出现在文档里，
 * 就等于对外公布「可以把真实扣款切成跳过扣款」，必须与 club 侧同等处理。
 */
const PROFIT_PAYMENT_MODE_SWAGGER_PATHS = ['/profit/dev/payment-mode'] as const;
/** 商家端 dev-only 支付模式开关接口的 Swagger 分组名 */
const PROFIT_PAYMENT_MODE_SWAGGER_TAG = 'Profit / Payments · 调试';
/** 支付模式调试通道的「开关 → 清单 / 分组」映射，避免两侧逻辑各写一份后漂移 */
const PAYMENT_MODE_SWAGGER_GROUPS = [
  {
    paths: CLUB_PAYMENT_MODE_SWAGGER_PATHS,
    tag: CLUB_PAYMENT_MODE_SWAGGER_TAG,
  },
  {
    paths: PROFIT_PAYMENT_MODE_SWAGGER_PATHS,
    tag: PROFIT_PAYMENT_MODE_SWAGGER_TAG,
  },
] as const;

/** 剥掉文档路径上的全局前缀，还原成与装饰器一致的相对路由 */
function toRelativeSwaggerPath(path: string): string {
  if (path === SWAGGER_GLOBAL_PREFIX) {
    return '/';
  }
  if (path.startsWith(`${SWAGGER_GLOBAL_PREFIX}/`)) {
    return path.slice(SWAGGER_GLOBAL_PREFIX.length);
  }
  return path;
}

/** 找出文档中命中给定相对路由的所有真实 key（兼容带 / 不带全局前缀两种形态） */
function collectSwaggerPathsByTarget(
  paths: Record<string, SwaggerPathItemLike>,
  targets: readonly string[],
): string[] {
  const targetSet = new Set<string>(targets);
  return Object.keys(paths).filter((path) =>
    targetSet.has(toRelativeSwaggerPath(path)),
  );
}

/** 按相对路由批量剔除文档路径 */
function deleteSwaggerPaths(
  paths: Record<string, SwaggerPathItemLike>,
  targets: readonly string[],
): void {
  for (const path of collectSwaggerPathsByTarget(paths, targets)) {
    delete paths[path];
  }
}

/** 从 tags 列表移除指定分组；tags 不存在时保持原样，避免凭空造出空数组 */
function removeSwaggerTag(
  tags: SwaggerTagLike[] | undefined,
  tagName: string,
): SwaggerTagLike[] | undefined {
  if (!tags) {
    return tags;
  }
  return tags.filter((tag) => tag.name !== tagName);
}

function ensureSwaggerTag(
  tags: SwaggerTagLike[] | undefined,
  targetTag: SwaggerTagLike,
): SwaggerTagLike[] {
  const normalizedTags = tags ? [...tags] : [];
  const exists = normalizedTags.some((tag) => tag.name === targetTag.name);
  if (!exists) {
    normalizedTags.push(targetTag);
  }
  return normalizedTags;
}

/**
 * 按当前环境开关裁剪 Swagger 文档。
 *
 * 调试类接口一律 fail-closed：只有调用方显式传 `true` 才保留，
 * 漏传 / undefined 都按「不可见」处理，避免新增调用点时忘记传参
 * 就把 dev 接口留在生产文档里。
 */
export function filterSwaggerDocumentForEnvironment(
  document: SwaggerDocumentLike,
  options: SwaggerEnvironmentFilterOptions,
): SwaggerDocumentLike {
  const paths = document.paths;
  if (!paths) {
    return document;
  }

  // 两侧调试通道各自独立裁决：只开 club 开关时不能把 profit 的入口一并留下
  const paymentModeDebugVisibility: ReadonlyMap<string, boolean> = new Map([
    [
      CLUB_PAYMENT_MODE_SWAGGER_TAG,
      options.clubPaymentModeDebugVisible === true,
    ],
    [
      PROFIT_PAYMENT_MODE_SWAGGER_TAG,
      options.profitPaymentModeDebugVisible === true,
    ],
  ]);
  for (const group of PAYMENT_MODE_SWAGGER_GROUPS) {
    if (paymentModeDebugVisibility.get(group.tag) === true) {
      continue;
    }
    deleteSwaggerPaths(paths, group.paths);
    document.tags = removeSwaggerTag(document.tags, group.tag);
  }

  if (!options.manualConfirmPaidEnabled) {
    deleteSwaggerPaths(paths, CLUB_MANUAL_CONFIRM_PAID_SWAGGER_PATHS);
    return document;
  }

  document.tags = ensureSwaggerTag(document.tags, {
    name: CLUB_MANUAL_CONFIRM_PAID_FALLBACK_TAG,
    description: '仅开发联调使用的支付兜底接口，生产链路请改用支付回调驱动。',
  });

  for (const path of collectSwaggerPathsByTarget(
    paths,
    CLUB_MANUAL_CONFIRM_PAID_SWAGGER_PATHS,
  )) {
    const operation = paths[path]?.post;
    if (!operation) {
      continue;
    }

    operation.tags = Array.from(
      new Set([
        ...(operation.tags ?? []),
        CLUB_MANUAL_CONFIRM_PAID_FALLBACK_TAG,
      ]),
    );
  }

  return document;
}
