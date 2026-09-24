// 二维码海报配置的共享类型、默认值与脏数据规范化工具。

/** 二维码海报主题色：lime=品牌青柠 / forest=深林绿 / ink=墨夜蓝 / amber=暖阳浅色。 */
export type TableQrPosterTheme = 'lime' | 'forest' | 'ink' | 'amber';

/** 二维码海报配置（门店级）。 */
export interface TableQrPosterConfig {
  /** 主题色。 */
  theme: TableQrPosterTheme;
  /** 海报标语（二维码下方短句）。 */
  slogan: string;
  /** 是否在海报头部展示门店 Logo（加载失败回退品牌图标）。 */
  showStoreLogo: boolean;
}

/** 二维码海报配置部分更新入参（PATCH 语义，只更新传入字段）。 */
export interface TableQrPosterConfigUpdate {
  theme?: TableQrPosterTheme;
  slogan?: string;
  showStoreLogo?: boolean;
}

/** 可用主题白名单：非法值一律回退调用方默认主题。 */
export const TABLE_QR_POSTER_THEMES: readonly TableQrPosterTheme[] = [
  'lime',
  'forest',
  'ink',
  'amber',
];

/** 默认桌码海报配置：未配置或配置非法时使用。 */
export const DEFAULT_TABLE_QR_POSTER_CONFIG: TableQrPosterConfig = {
  theme: 'lime',
  slogan: '扫码点餐 · 下单免等待',
  showStoreLogo: true,
};

/** 标语最大长度：超出截断，避免长文案撑破海报版式。 */
export const TABLE_QR_POSTER_SLOGAN_MAX_LENGTH = 24;

const isTableQrPosterTheme = (value: unknown): value is TableQrPosterTheme =>
  typeof value === 'string' &&
  TABLE_QR_POSTER_THEMES.includes(value as TableQrPosterTheme);

/**
 * 规范化二维码海报配置：字段级白名单，非法或缺失字段回退业务默认值。
 *
 * @param value 数据库读取或调用方合并后的待校验值。
 * @param defaults 当前业务使用的完整默认配置；缺省保持桌码既有行为。
 * @returns 可安全用于持久化与前端渲染的完整配置。
 */
export function normalizeTableQrPosterConfig(
  value: unknown,
  defaults: TableQrPosterConfig = DEFAULT_TABLE_QR_POSTER_CONFIG,
): TableQrPosterConfig {
  if (!value || typeof value !== 'object') {
    return { ...defaults };
  }

  const candidate = value as Partial<{
    theme: unknown;
    slogan: unknown;
    showStoreLogo: unknown;
  }>;
  const slogan =
    typeof candidate.slogan === 'string'
      ? candidate.slogan.trim().slice(0, TABLE_QR_POSTER_SLOGAN_MAX_LENGTH)
      : '';

  return {
    theme: isTableQrPosterTheme(candidate.theme)
      ? candidate.theme
      : defaults.theme,
    slogan: slogan === '' ? defaults.slogan : slogan,
    showStoreLogo:
      typeof candidate.showStoreLogo === 'boolean'
        ? candidate.showStoreLogo
        : defaults.showStoreLogo,
  };
}
