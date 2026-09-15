/**
 * 会员过期错误码「契约一致性」检查。
 *
 * 背景：`MEMBERSHIP_EXPIRED` 这个字符串是后端与两个前端之间的隐式契约。
 * 后端在抛出会员过期异常时带上它，两个前端据此把「门店不能下单」与
 * 普通错误区分开，展示引导弹窗而非普通报错。
 *
 * 危险在于：**三处各自硬编码，没有任何编译期或运行期机制保证一致。**
 * 一旦有人只改了后端（比如 typo 或重命名），前端不会报错，只会静默退化成
 * 普通 toast —— 顾客看不到「请到前台点餐」的引导，且这个问题极难被发现
 * （功能看起来还在，只是体验降级）。
 *
 * 因此用本脚本在 CI / 本地守住这个契约。
 *
 * 用法：
 *   node scripts/check-membership-contract.mjs
 *       检查三处常量是否一致，不一致以退出码 1 失败
 *   node scripts/check-membership-contract.mjs --json
 *       输出机器可读结果，供 CI 解析
 *
 * 环境变量（前端仓库不在默认同级目录时使用）：
 *   PURELY_PROFIT_ROOT=/path/to/purelyProfit
 *   PURELY_CLUB_ROOT=/path/to/purelyClub
 *
 * 找不到前端仓库时只告警不失败 —— 允许在只有后端的环境中跑通，
 * 避免把环境问题误报成契约问题。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hasJsonFlag = process.argv.includes('--json');

const serverRoot = resolve(__dirname, '..');
const profitRoot = process.env.PURELY_PROFIT_ROOT ?? resolve(serverRoot, '../purelyProfit');
const clubRoot = process.env.PURELY_CLUB_ROOT ?? resolve(serverRoot, '../purelyClub');

/** 三处声明点：常量名不同（后端 ERROR_CODE，前端 CODE），但值必须一致 */
const CONTRACT_TARGETS = [
  {
    label: '后端 membership-downgrade.service.ts',
    file: resolve(
      serverRoot,
      'src/purely-profit/member/platform-membership/membership-downgrade.service.ts',
    ),
    pattern: /MEMBERSHIP_EXPIRED_ERROR_CODE\s*(?::[^=]*)?=\s*['"]([^'"]+)['"]/,
  },
  {
    label: 'purelyProfit membershipExpired.ts',
    file: resolve(profitRoot, 'src/utils/http/membershipExpired.ts'),
    pattern: /MEMBERSHIP_EXPIRED_CODE\s*(?::[^=]*)?=\s*['"]([^'"]+)['"]/,
  },
  {
    label: 'purelyClub membershipExpired.ts',
    file: resolve(clubRoot, 'src/utils/http/membershipExpired.ts'),
    pattern: /MEMBERSHIP_EXPIRED_CODE\s*(?::[^=]*)?=\s*['"]([^'"]+)['"]/,
  },
];

const results = [];
let hasFailure = false;

for (const target of CONTRACT_TARGETS) {
  if (!existsSync(target.file)) {
    results.push({
      label: target.label,
      file: target.file,
      value: null,
      status: 'missing',
    });
    continue;
  }

  const content = readFileSync(target.file, 'utf8');
  const matched = content.match(target.pattern);

  if (!matched) {
    // 声明被删除或改名 —— 属于契约破坏，必须失败
    hasFailure = true;
    results.push({
      label: target.label,
      file: target.file,
      value: null,
      status: 'not-found',
    });
    continue;
  }

  results.push({
    label: target.label,
    file: target.file,
    value: matched[1],
    status: 'ok',
  });
}

// 已解析出的值两两比对
const declaredValues = results.filter((item) => item.value !== null);
const distinctValues = [...new Set(declaredValues.map((item) => item.value))];

if (distinctValues.length > 1) {
  hasFailure = true;
}

// ─── 输出 ────────────────────────────────────────────────────────────────

if (hasJsonFlag) {
  console.log(
    JSON.stringify(
      {
        ok: !hasFailure,
        distinctValues,
        results: results.map((item) => ({
          label: item.label,
          file: item.file,
          value: item.value,
          status: item.status,
        })),
      },
      null,
      2,
    ),
  );
  process.exitCode = hasFailure ? 1 : 0;
} else {
  console.log('会员过期错误码契约检查\n');

  for (const item of results) {
    if (item.status === 'ok') {
      console.log(`  ✓ ${item.label}  →  '${item.value}'`);
    } else if (item.status === 'missing') {
      console.log(`  ⚠ ${item.label}  →  文件不存在，已跳过（${item.file}）`);
    } else {
      console.log(`  ✗ ${item.label}  →  未找到常量声明（${item.file}）`);
    }
  }

  const missingCount = results.filter((item) => item.status === 'missing').length;
  const notFoundCount = results.filter((item) => item.status === 'not-found').length;

  if (distinctValues.length > 1) {
    console.log(
      `\n❌ 常量值不一致：${distinctValues.map((value) => `'${value}'`).join(' vs ')}\n` +
        '   这会导致一端识别不到另一端的会员过期错误，引导弹窗静默退化成普通报错。\n' +
        '   请统一三处的取值。\n',
    );
  } else if (notFoundCount > 0) {
    console.log(
      `\n❌ 有 ${notFoundCount} 处缺少常量声明。\n` +
        '   若是有意移除，请同步更新本脚本的 CONTRACT_TARGETS。\n',
    );
  } else {
    console.log(
      `\n✅ 契约一致（'${distinctValues[0] ?? ''}'）` +
        (missingCount > 0 ? `，${missingCount} 处文件缺失已跳过` : '') +
        '。\n',
    );
  }

  process.exitCode = hasFailure ? 1 : 0;
}
