/**
 * `tencentCos` 配置块：腾讯云 COS 对象存储。
 *
 * 用于头像、商品图等文件上传。
 * 未配置时上传接口返回 501（功能未启用）。
 */
export interface TencentCosConfig {
  /** 腾讯云 SecretId */
  secretId: string;
  /** 腾讯云 SecretKey */
  secretKey: string;
  /** COS 存储桶地域（如 ap-shanghai、ap-guangzhou） */
  region: string;
  /** COS 存储桶名称（格式：BucketName-AppId） */
  bucket: string;
  /** CDN 加速域名（可选，配置后返回 CDN URL 而非 COS 原始 URL） */
  cdnDomain: string;
  /** 上传文件路径前缀（如 'uploads/'，末尾需带 /） */
  pathPrefix: string;
}

/** 解析 `tencentCos` 配置块。 */
export function resolveTencentCosConfig(): TencentCosConfig {
  return {
    /** 腾讯云 SecretId */
    secretId: process.env.TENCENT_COS_SECRET_ID ?? '',
    /** 腾讯云 SecretKey */
    secretKey: process.env.TENCENT_COS_SECRET_KEY ?? '',
    /** COS 存储桶地域（如 ap-shanghai、ap-guangzhou） */
    region: process.env.TENCENT_COS_REGION ?? '',
    /** COS 存储桶名称（格式：BucketName-AppId） */
    bucket: process.env.TENCENT_COS_BUCKET ?? '',
    /** CDN 加速域名（可选，配置后返回 CDN URL 而非 COS 原始 URL） */
    cdnDomain: process.env.TENCENT_COS_CDN_DOMAIN ?? '',
    /** 上传文件路径前缀（如 'uploads/'，末尾需带 /） */
    pathPrefix: process.env.TENCENT_COS_PATH_PREFIX ?? 'uploads/',
  };
}
