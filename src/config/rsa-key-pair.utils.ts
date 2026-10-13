import { generateKeyPairSync } from 'node:crypto';

/**
 * Cluster 模式下的共享 RSA 密钥对（登录密码加密/解密使用）。
 *
 * 背景：AuthRsaService 在未配置 AUTH_RSA_PUBLIC_KEY / AUTH_RSA_PRIVATE_KEY 时
 * 会在进程内自行生成密钥对。Cluster 多 Worker 场景下，若各自生成，
 * 前端拿到的公钥可能由 A Worker 颁发，而请求落到 B Worker 时无法解密，
 * 表现为「登录间歇性失败」。
 *
 * 解决：在 primary 进程 fork 之前生成一次密钥对并写入 process.env，
 * 所有 Worker 通过环境变量继承同一份密钥。
 *
 * 注意：单进程（start:dev / start）无需调用；多实例（多台服务器负载均衡）部署
 * 必须在环境变量中显式配置相同的密钥对，该方法无法跨进程/跨机器共享。
 */

const RSA_MODULUS_LENGTH = 2048;

/**
 * 确保当前进程环境已持有 RSA 密钥对。
 *
 * 已通过环境变量配置时直接复用（不覆盖显式配置）；否则生成新密钥对并写入环境变量。
 */
export function ensureSharedRsaKeyPair(): void {
  if (process.env.AUTH_RSA_PUBLIC_KEY && process.env.AUTH_RSA_PRIVATE_KEY) {
    return;
  }

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: RSA_MODULUS_LENGTH,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  process.env.AUTH_RSA_PUBLIC_KEY = publicKey;
  process.env.AUTH_RSA_PRIVATE_KEY = privateKey;
}
