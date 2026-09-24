/**
 * 扫码二维码「路径段 / token 形态」跨仓契约检查。
 *
 * 背景：二维码内容 `{base}/t/{token}`、`{base}/p/{token}` 的首段 `t`、`p`
 * 由前后端各持一份常量：后端 `scan-qr-payload.utils.ts` 拼 URL，
 * 前端 `purelyClub/src/utils/scanPayload.ts` 按首段粗分扫码类型；
 * token 形态正则（长度上下限）同理。两侧**没有任何编译期联系**，只有注释互相提醒。
 *
 * 危险在于：一旦只改了一侧（改名、typo、新增场景顺手换个段名），
 * 已经印出去的桌码不会报错，只会被前端判成 `unknown` 而走进「门店入店」分支
 * ——功能看起来还在，实际桌码静默失效，且只能靠用户在店里扫不出来才发现。
 * 已印刷物料的失效是不可逆的，所以这个契约必须在 CI 里被守住。
 *
 * 用法：
 *   node scripts/check-scan-qr-path-contract.mjs
 *       检查各组契约，不一致以退出码 1 失败
 *   node scripts/check-scan-qr-path-contract.mjs --json
 *       输出机器可读结果，供 CI 解析
 *
 * 环境变量（前端仓库不在默认同级目录时使用）：
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
const clubRoot =
  process.env.PURELY_CLUB_ROOT ?? resolve(serverRoot, '../purelyClub');

const SERVER_PAYLOAD_UTILS = resolve(
  serverRoot,
  'src/purely-profit/operations/scan-qr-payload.utils.ts',
);
const SERVER_STORE_INVITE_QR_UTILS = resolve(
  serverRoot,
  'src/purely-profit/stores/store-invite-code-qr.utils.ts',
);
const CLUB_SCAN_PAYLOAD = resolve(clubRoot, 'src/utils/scanPayload.ts');

/**
 * 把「段列表」的源码片段归一化成可比较的字符串（`i,invite`）。
 *
 * 两侧写法不同：后端是 `['i', 'invite']` 字面量，前端是
 * `new Set([SCAN_PATH_KINDS.storeInvite, 'invite'])`（带常量引用），
 * 因此统一抽成「排序后的段名列表」再比：顺序不同不算漂移，缺段才算。
 */
function normalizeSegmentList(capture, fileContent = '') {
  const segments = new Set();

  for (const matched of capture.matchAll(/['"]([^'"]+)['"]/gu)) {
    segments.add(matched[1]);
  }
  // SCAN_PATH_KINDS.xxx 这类引用按同文件内的常量取值还原
  for (const matched of capture.matchAll(/SCAN_PATH_KINDS\.(\w+)/gu)) {
    const declared = new RegExp(`${matched[1]}:\\s*['"]([^'"]+)['"]`, 'u').exec(
      fileContent,
    );
    if (declared) {
      segments.add(declared[1]);
    }
  }

  return [...segments].sort().join(',');
}

/**
 * 契约分组：同一组内的所有声明点取值必须一致。
 *
 * 门店邀请码的入口段（`i` / `invite`）是 **env 可配项**
 * （`CLUB_STORE_INVITE_QR_ENTRY_PATH`）—— 比桌码 / 空间码的代码常量更容易被改坏：
 * 生成侧拼出的段一旦不在解析侧白名单里，已印刷物料会静默失效且不报错，
 * 所以这两组契约比桌码那两组更需要守住。
 */
const CONTRACT_GROUPS = [
  {
    name: '桌码路径段',
    consequence:
      '前端无法把扫码内容识别为桌码，已印刷桌码会静默走「门店入店」分支而失效',
    targets: [
      {
        label: '后端 SCAN_QR_TABLE_PATH',
        file: SERVER_PAYLOAD_UTILS,
        pattern: /SCAN_QR_TABLE_PATH\s*=\s*['"]([^'"]+)['"]/,
      },
      {
        label: '前端 SCAN_PATH_KINDS.table',
        file: CLUB_SCAN_PAYLOAD,
        pattern: /table:\s*['"]([^'"]+)['"]/,
      },
    ],
  },
  {
    name: '空间码路径段',
    consequence:
      '前端无法把扫码内容识别为空间码，已印刷空间码会静默走「门店入店」分支而失效',
    targets: [
      {
        label: '后端 SCAN_QR_SPACE_PATH',
        file: SERVER_PAYLOAD_UTILS,
        pattern: /SCAN_QR_SPACE_PATH\s*=\s*['"]([^'"]+)['"]/,
      },
      {
        label: '前端 SCAN_PATH_KINDS.space',
        file: CLUB_SCAN_PAYLOAD,
        pattern: /space:\s*['"]([^'"]+)['"]/,
      },
    ],
  },
  {
    name: '桌码 token 最小长度',
    consequence:
      '一侧放宽一侧收紧时，合法 token 会被判为非法，已印刷桌码扫不出来',
    targets: [
      {
        label: '后端 TABLE_TOKEN_PATTERN',
        file: SERVER_PAYLOAD_UTILS,
        pattern: /TABLE_TOKEN_PATTERN\s*=\s*\/[^/]*\{(\d+),/,
      },
      {
        label: '前端 TABLE_TOKEN_PATTERN',
        file: CLUB_SCAN_PAYLOAD,
        pattern: /TABLE_TOKEN_PATTERN\s*=\s*\/[^/]*\{(\d+),/,
      },
    ],
  },
  {
    name: '空间码 token 形态',
    consequence:
      '一侧放宽一侧收紧时，合法 token 会被判为非法，已印刷空间码扫不出来；' +
      '服务端 extractSpaceQrToken 与前端 extractSpaceToken 也会对同一张码给出不同结果',
    targets: [
      {
        label: '后端 SPACE_TOKEN_PATTERN',
        file: SERVER_PAYLOAD_UTILS,
        // 形如 /^[A-Za-z0-9-]{16,64}$/：取长度上下限（16,64）整体比对
        pattern: /SPACE_TOKEN_PATTERN\s*=\s*\/[^/]*\{(\d+,\d+)\}/,
      },
      {
        label: '前端 SPACE_TOKEN_PATTERN',
        file: CLUB_SCAN_PAYLOAD,
        pattern: /SPACE_TOKEN_PATTERN\s*=\s*\/[^/]*\{(\d+,\d+)\}/,
      },
    ],
  },
  {
    name: '进店码入口段白名单',
    consequence:
      '服务端 V1_PATH_PATTERN 与前端分类只认白名单内的入口段，' +
      '一侧多段 / 少段会让该段下的已印刷进店码静默失效（不报错，只能等顾客扫不出来）',
    targets: [
      {
        label: '后端 STORE_INVITE_QR_ENTRY_SEGMENTS',
        file: SERVER_STORE_INVITE_QR_UTILS,
        pattern: /STORE_INVITE_QR_ENTRY_SEGMENTS\s*=\s*\[([^\]]*)\]/u,
        normalize: normalizeSegmentList,
      },
      {
        label: '前端 STORE_INVITE_SEGMENTS',
        file: CLUB_SCAN_PAYLOAD,
        pattern:
          /STORE_INVITE_SEGMENTS\s*=\s*new Set<[^>]*>\(\[([\s\S]*?)\]\)/u,
        normalize: normalizeSegmentList,
      },
    ],
  },
  {
    name: '进店码默认入口段',
    consequence:
      '入口段默认值（未配置 / 配置非法时的回退值）两侧不一致，' +
      '会让未配置 env 的环境生成的进店码在另一侧认不出来',
    targets: [
      {
        label: '后端 STORE_INVITE_QR_DEFAULT_ENTRY_SEGMENT',
        file: SERVER_STORE_INVITE_QR_UTILS,
        pattern:
          /STORE_INVITE_QR_DEFAULT_ENTRY_SEGMENT[^=]*=\s*['"]([^'"]+)['"]/u,
      },
      {
        label: '前端 SCAN_PATH_KINDS.storeInvite',
        file: CLUB_SCAN_PAYLOAD,
        pattern: /storeInvite:\s*['"]([^'"]+)['"]/u,
      },
    ],
  },
];

const groups = [];
let hasFailure = false;

for (const group of CONTRACT_GROUPS) {
  const results = [];

  for (const target of group.targets) {
    if (!existsSync(target.file)) {
      results.push({ ...target, value: null, status: 'missing' });
      continue;
    }

    const fileContent = readFileSync(target.file, 'utf8');
    const matched = fileContent.match(target.pattern);
    const value = matched
      ? (target.normalize?.(matched[1], fileContent) ?? matched[1])
      : null;
    results.push(
      value !== null
        ? { ...target, value, status: 'ok' }
        : { ...target, value: null, status: 'not-found' },
    );
  }

  const values = [
    ...new Set(
      results.filter((item) => item.value !== null).map((item) => item.value),
    ),
  ];
  const missingCount = results.filter(
    (item) => item.status === 'missing',
  ).length;
  const notFoundCount = results.filter(
    (item) => item.status === 'not-found',
  ).length;
  // 只有一侧找到文件时允许通过（例如纯后端环境），但两侧都在却不一致必须失败
  const inconsistent = values.length > 1;
  if (inconsistent || notFoundCount > 0) {
    hasFailure = true;
  }

  groups.push({
    name: group.name,
    consequence: group.consequence,
    results,
    values,
    missingCount,
    notFoundCount,
    inconsistent,
  });
}

// ─── 输出 ────────────────────────────────────────────────────────────────

if (hasJsonFlag) {
  console.log(
    JSON.stringify(
      {
        ok: !hasFailure,
        groups: groups.map((group) => ({
          name: group.name,
          values: group.values,
          results: group.results.map((item) => ({
            label: item.label,
            file: item.file,
            value: item.value,
            status: item.status,
          })),
        })),
      },
      null,
      2,
    ),
  );
  process.exitCode = hasFailure ? 1 : 0;
} else {
  console.log('扫码二维码路径契约检查\n');

  for (const group of groups) {
    console.log(`[${group.name}]`);
    for (const item of group.results) {
      if (item.status === 'ok') {
        console.log(`  ✓ ${item.label}  →  '${item.value}'`);
      } else if (item.status === 'missing') {
        console.log(`  ⚠ ${item.label}  →  文件不存在，已跳过（${item.file}）`);
      } else {
        console.log(`  ✗ ${item.label}  →  未找到常量声明（${item.file}）`);
      }
    }

    if (group.inconsistent) {
      console.log(
        `  ❌ 取值不一致：${group.values.map((value) => `'${value}'`).join(' vs ')}\n` +
          `     ${group.consequence}\n`,
      );
    } else if (group.notFoundCount > 0) {
      console.log(
        `  ❌ 有 ${group.notFoundCount} 处缺少常量声明。\n` +
          '     若是有意移除，请同步更新本脚本的 CONTRACT_GROUPS。\n',
      );
    } else {
      console.log(
        `  ✅ 一致（'${group.values[0] ?? ''}'）` +
          (group.missingCount > 0
            ? `，${group.missingCount} 处文件缺失已跳过`
            : '') +
          '\n',
      );
    }
  }

  console.log(
    hasFailure
      ? '❌ 契约检查未通过：请先统一前后端取值再合入。\n'
      : '✅ 前后端扫码路径契约一致。\n',
  );
  process.exitCode = hasFailure ? 1 : 0;
}
