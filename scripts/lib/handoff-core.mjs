import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

/**
 * Handoff-Gate 校验内核
 *
 * 把「模型自述通过」从流程中移除：
 * - passes 只能由 run 子命令在命令真实退出码达标后翻转，模型只能写 candidate_pass；
 * - 证据文件由脚本创建并写入签名头，事后改动会导致 hash 失配；
 * - 实际改动必须落在 feature.allowed_paths 白名单内（基于文件快照比对，不执行任何 git 操作）；
 * - feature_list 契约被 hash 锁定，任何窗口改动 description / acceptance_steps 即报错。
 */

export const ROOT = process.cwd();
export const DIR = path.join(ROOT, '.handoff');
export const EVIDENCE_DIR = path.join(DIR, 'evidence');
export const F_FEATURES = path.join(DIR, 'feature_list.json');
export const F_PACKET = path.join(DIR, 'handoff_packet.json');
export const F_CLEAN = path.join(DIR, 'clean_state.json');
export const F_SIGNED = path.join(DIR, 'verify_state.json');
export const F_LOCK = path.join(DIR, 'feature_list.lock');
export const F_REPORT = path.join(DIR, 'release-report.txt');
export const F_PROMPT = path.join(DIR, 'next-prompt.txt');
export const F_BASELINE = path.join(DIR, 'baseline.json');
export const F_MODE_DOC = path.join(ROOT, 'docs', 'docs', 'handoff-gate-mode.md');

const MAX_DEPTH = 4;
const MAX_ATTEMPTS = 3;
const VAGUE_WORDS = /继续|完善|优化一下|推进|接着|剩余部分|大概|差不多/;

export const readJson = (file) => {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
};

export const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
};

export const sh = (cmd, timeout = 15 * 60 * 1000) => {
  try {
    const out = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      maxBuffer: 20 * 1024 * 1024,
      shell: '/bin/zsh',
    });
    return { code: 0, out: out ?? '' };
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    return { code: Number.isInteger(err.status) ? err.status : 1, out };
  }
};

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// ─── 文件快照（替代 git 改动检测，本模式不执行任何 git 操作）────────────────

/** 任意层级都跳过的目录 / 文件 */
const SNAPSHOT_SKIP_ANY = new Set(['.git', 'node_modules', '.handoff', '.DS_Store', '.turbo']);

/** 仅根级跳过的构建产物目录 */
const SNAPSHOT_SKIP_ROOT = new Set(['dist', 'lib', 'build', 'coverage', '.next', '.nuxt', 'out']);

const collectFileSignatures = (absDir, prefix, out) => {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.forEach((entry) => {
    if (SNAPSHOT_SKIP_ANY.has(entry.name)) return;
    if (!prefix && SNAPSHOT_SKIP_ROOT.has(entry.name)) return;
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absPath = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      collectFileSignatures(absPath, relPath, out);
      return;
    }
    if (!entry.isFile()) return;
    try {
      const stat = fs.statSync(absPath);
      out.set(relPath, `${stat.size}:${Math.round(stat.mtimeMs)}`);
    } catch {
      // 读取失败的文件不计入快照，避免个别权限问题中断整个交接
    }
  });
};

/** 采集当前工作区文件签名（相对路径 → 大小:修改时间） */
export const snapshotTree = () => {
  const signatures = new Map();
  collectFileSignatures(ROOT, '', signatures);
  return signatures;
};

/** 把当前工作区状态写为下一段的比对基线 */
export const writeBaseline = (sessionId) => {
  writeJson(F_BASELINE, {
    session_id: sessionId,
    captured_at: new Date().toISOString(),
    files: Object.fromEntries(snapshotTree()),
  });
};

/**
 * 与基线比对，返回本段新增 / 修改 / 删除的文件。
 * 未 seal 过（无基线）时返回 null，由调用方决定如何告警。
 */
export const changedFilesSinceBaseline = () => {
  const baseline = readJson(F_BASELINE);
  const files = baseline?.files;
  if (!files || typeof files !== 'object') return null;
  const before = new Map(Object.entries(files));
  const after = snapshotTree();
  const changed = new Set();
  after.forEach((signature, file) => {
    if (before.get(file) !== signature) changed.add(file);
  });
  before.forEach((signature, file) => {
    if (!after.has(file)) changed.add(file);
  });
  return [...changed].sort();
};

const globToReg = (glob) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')}$`,
  );

export const matchAny = (file, globs) => globs.some((glob) => globToReg(glob).test(file));

export const normalizeStep = (step) => {
  if (typeof step === 'string') return { cmd: step, expect_exit: 0 };
  return {
    cmd: String(step?.cmd ?? ''),
    expect_exit: Number.isInteger(step?.expect_exit) ? step.expect_exit : 0,
  };
};

export const shapeFeature = (raw) => ({
  id: String(raw?.id ?? ''),
  description: String(raw?.description ?? ''),
  allowed_paths: Array.isArray(raw?.allowed_paths) ? raw.allowed_paths.map(String) : [],
  steps: Array.isArray(raw?.acceptance_steps) ? raw.acceptance_steps.map(normalizeStep) : [],
  candidate_pass: raw?.candidate_pass === true,
  passes: raw?.passes === true,
});

export const contractHash = (features) =>
  sha256(
    JSON.stringify({
      task_id: features?.task_id ?? '',
      overall_goal: features?.overall_goal ?? '',
      invariants: features?.invariants ?? [],
      features: (features?.features ?? []).map((item) => ({
        id: item?.id,
        description: item?.description,
        allowed_paths: item?.allowed_paths,
        acceptance_steps: item?.acceptance_steps,
      })),
    }),
  );

export const evidenceHeader = ({ kind, target, sessionId, cmd }) =>
  `# handoff-evidence kind=${kind} target=${target} session=${sessionId} ts=${Date.now()}\n# cmd: ${cmd}`;

export const writeEvidence = (relPath, header, exitCode, body) => {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const content = `${header}\n# exit: ${exitCode}\n${body || '(no output)'}\n`;
  fs.writeFileSync(abs, content, 'utf-8');
  return sha256(content);
};

const inspectEvidence = (relPath) => {
  if (!relPath || relPath === 'none') return { ok: false, reason: '证据指针缺失' };
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return { ok: false, reason: `证据文件不存在：${relPath}` };
  const content = fs.readFileSync(abs, 'utf-8');
  const first = content.split('\n')[0] ?? '';
  if (!first.startsWith('# handoff-evidence')) {
    return { ok: false, reason: `证据非脚本生成（缺签名头）：${relPath}` };
  }
  return { ok: true, hash: sha256(content) };
};

/**
 * 出口校验。phase='pre' 时跳过只有出口才成立的检查（证据指针、next_action、出口顺序），
 * 供 run 子命令在执行前调用，避免与「证据后置生成」形成循环依赖。
 */
export const validate = (phase = 'exit') => {
  const isExit = phase === 'exit';
  const errors = [];
  const warnings = [];
  const fail = (msg) => errors.push(msg);
  const warn = (msg) => warnings.push(msg);

  const featuresRaw = readJson(F_FEATURES);
  const packet = readJson(F_PACKET);
  const clean = readJson(F_CLEAN);
  const signed = readJson(F_SIGNED) ?? {};
  const lock = fs.existsSync(F_LOCK) ? fs.readFileSync(F_LOCK, 'utf-8').trim() : '';

  if (!featuresRaw) fail('缺少 .handoff/feature_list.json（或不是合法 JSON）');
  if (!packet) fail('缺少 .handoff/handoff_packet.json（或不是合法 JSON）');
  if (!clean) fail('缺少 .handoff/clean_state.json（或不是合法 JSON）');
  if (!featuresRaw || !packet || !clean) return { errors, warnings, featuresRaw, packet, clean, signed };

  if (!lock) fail('缺少 .handoff/feature_list.lock（由 seal 生成），契约无法校验');
  else if (lock !== contractHash(featuresRaw)) {
    fail('[契约] feature_list 的 description / acceptance_steps / allowed_paths 被改动过，交接契约不可变');
  }

  const feats = (featuresRaw.features ?? []).map(shapeFeature);
  if (feats.length === 0) fail('feature_list.features 为空');
  const invariants = (featuresRaw.invariants ?? []).map(normalizeStep);
  if (invariants.length === 0) warn('未声明 invariants，本次交接没有全局回归基线');

  feats.forEach((feat) => {
    if (!feat.allowed_paths.length) warn(`${feat.id} 未声明 allowed_paths，跳过越界检查`);
    if (!feat.steps.length) fail(`${feat.id} 的 acceptance_steps 为空`);
    feat.steps.forEach((step, idx) => {
      if (!step.cmd.trim()) fail(`${feat.id} 第 ${idx} 条 acceptance_step 的 cmd 为空`);
    });
    if (!feat.passes) return;
    const record = signed[feat.id];
    if (!record) {
      fail(`[自述通过] ${feat.id}.passes=true 但无脚本签名；passes 只能由 run 子命令翻转`);
      return;
    }
    if (record.steps !== feat.steps.length) fail(`[自述通过] ${feat.id} 签名的步骤数与契约不一致`);
    (record.evidence ?? []).forEach((item) => {
      const inspected = inspectEvidence(item.path);
      if (!inspected.ok) fail(inspected.reason);
      else if (inspected.hash !== item.hash) fail(`[证据漂移] ${item.path} 在签名后被改动`);
    });
  });

  const cursor = packet.cursor ?? {};
  const feature = feats.find((item) => item.id === cursor.feature_id);
  if (!feature) {
    fail('cursor.feature_id 未指向 feature_list 中存在的 feature');
  } else {
    const nextIndex = Number.isInteger(cursor.next_step_index) ? cursor.next_step_index : 0;
    const done = Array.isArray(cursor.done_steps) ? cursor.done_steps : [];
    if (nextIndex < 0 || nextIndex > feature.steps.length) {
      fail(`cursor.next_step_index=${nextIndex} 越界（feature 共 ${feature.steps.length} 步）`);
    }
    if (done.length !== nextIndex || !done.every((value, idx) => value === idx)) {
      fail('cursor.done_steps 必须是 [0..next_step_index-1] 的连续前缀，禁止跳步');
    }
    if (nextIndex === feature.steps.length && !feature.passes) {
      warn(`${feature.id} 所有步骤已执行但 passes 仍为 false，请确认是否漏跑 run`);
    }
  }

  if (isExit) {
    const nextAction = packet.next_action ?? {};
    const nextId = nextAction.feature_id;
    const pending = feats.find((item) => !item.passes);
    if (typeof nextId !== 'string' || !nextId) {
      fail('next_action.feature_id 必须且只能是单个字符串');
    } else if (feature && !feature.passes) {
      if (nextId !== feature.id) {
        fail(`cursor 指向的 ${feature.id} 尚未通过，next_action 必须继续同一个 feature，不得换目标`);
      }
    } else if (!pending) {
      if (nextId !== 'none') fail('所有 feature 均已通过，next_action.feature_id 应写 none');
    } else if (nextId !== pending.id) {
      fail(`next_action 必须指向契约顺序中最靠前的待办 feature：${pending.id}；跳序需人工变更契约`);
    }
    const firstStep = String(nextAction.first_concrete_step ?? '');
    if (firstStep.length < 8 || VAGUE_WORDS.test(firstStep)) {
      fail('next_action.first_concrete_step 过于含糊，必须包含命令、路径或明确动作');
    }
    if (!String(nextAction.expected_evidence ?? '').trim()) {
      fail('next_action.expected_evidence 缺失，下一窗口无法判定成功');
    }
  }

  const attemptCount = Number.isInteger(packet.attempt_count) ? packet.attempt_count : 0;
  if (attemptCount >= 2) {
    const poor = (packet.failed_attempts ?? []).filter((item) => {
      const conclusion = String(item?.conclusion ?? '').trim();
      return conclusion.length < 10 || /报错|失败了|不行/.test(conclusion);
    });
    if (poor.length) fail(`[失败升级] 第 ${attemptCount} 次尝试仍缺根因结论，failed_attempts 必须写清因果`);
  }
  if (attemptCount >= MAX_ATTEMPTS) {
    fail(`[失败升级] 同一 feature 已累计 ${attemptCount} 次失败，禁止原样重开窗口；必须回中枢拆 feature`);
  }

  const segment = Number.isInteger(packet.segment_index) ? packet.segment_index : 1;
  if (segment > MAX_DEPTH) {
    fail(`[深度] 第 ${segment} 段超过上限 ${MAX_DEPTH}，必须先回中枢做全局对齐`);
  }
  if (packet.session_id && segment) {
    const expected = `session-${String(segment).padStart(3, '0')}`;
    if (packet.session_id !== expected) fail(`session_id 应为 ${expected}（与 segment_index 对齐）`);
  }

  if (isExit) {
    const pointer = packet.verdict_pointer ?? {};
    const testEvidence = inspectEvidence(pointer.test_output);
    if (!testEvidence.ok) fail(`test_output：${testEvidence.reason}`);
    const gateEvidence = inspectEvidence(pointer.gate_output);
    if (!gateEvidence.ok) fail(`gate_output：${gateEvidence.reason}`);
  }

  const touched = changedFilesSinceBaseline() ?? [];
  if (!fs.existsSync(F_BASELINE)) {
    fail('缺少 .handoff/baseline.json（由 seal 生成），越界检查无法执行');
  }
  if (feature && feature.allowed_paths.length) {
    touched.forEach((file) => {
      if (!matchAny(file, feature.allowed_paths)) {
        fail(`[越界] ${file} 不在 ${feature.id}.allowed_paths 内，越界改动禁止交接`);
      }
    });
  }
  if (isExit) {
    const declared = new Set(packet.changed_files ?? []);
    touched
      .filter((file) => !declared.has(file))
      .forEach((file) => warn(`实际改动未在 changed_files 声明：${file}`));
  }

  if (!Array.isArray(clean.blocking_issues)) {
    fail('clean_state.blocking_issues 必须是数组');
  } else if (clean.blocking_issues.length > 0) {
    fail('blocking_issues 非空，不允许生成交接包');
  }
  if (clean.tests_runnable !== true) fail('clean_state.tests_runnable 必须为 true');
  if (clean.working_directory_clean !== true) warn('working_directory_clean 非 true，请确认残留改动是否故意保留');
  if (isExit && fs.existsSync(F_CLEAN) && fs.existsSync(F_PACKET)) {
    if (fs.statSync(F_CLEAN).mtimeMs > fs.statSync(F_PACKET).mtimeMs) {
      fail('clean_state.json 晚于 handoff_packet.json，出口顺序违规');
    }
  }

  return { errors, warnings, featuresRaw, packet, clean, signed, feats, feature, invariants, attemptCount, segment };
};

export const writeReport = (ctx) => {
  const { errors, warnings, featuresRaw, packet, feats, feature, attemptCount, segment } = ctx;
  const lines = [
    `# Handoff 放行报告  ${new Date().toISOString()}`,
    `task: ${featuresRaw?.task_id ?? '-'} | segment: ${segment ?? '-'} | session: ${packet?.session_id ?? '-'}`,
    `cursor: ${feature?.id ?? '-'} step ${packet?.cursor?.next_step_index ?? '-'}/${feature?.steps.length ?? '-'}`,
    `attempt_count: ${attemptCount ?? 0}`,
    `feature 进度: ${(feats ?? []).filter((item) => item.passes).length}/${(feats ?? []).length} passes`,
    '-'.repeat(56),
    `结论: ${errors.length === 0 ? 'PASS' : `BLOCK(${errors.length})`}  警告: ${warnings.length}`,
    '',
    ...(errors.length ? ['[阻断]', ...errors.map((item) => `  - ${item}`), ''] : []),
    ...(warnings.length ? ['[警告]', ...warnings.map((item) => `  - ${item}`), ''] : []),
    ...(feature ? [`[改动白名单] ${feature.allowed_paths.join(', ') || '未声明'}`, ''] : []),
  ];
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(F_REPORT, `${lines.slice(0, 30).join('\n')}\n`, 'utf-8');
  return F_REPORT;
};

/**
 * 由脚本机械回填 next_action：永远指向契约顺序中最靠前的待办 feature。
 * 模型不再需要（也不允许）自己挑目标，跳序只能走人工变更契约。
 */
export const syncNextAction = (featuresRaw, packet) => {
  const pending = (featuresRaw.features ?? []).map(shapeFeature).find((item) => !item.passes);
  const sessionId = packet.session_id ?? 'session-001';
  packet.next_action = pending
    ? {
        feature_id: pending.id,
        first_concrete_step: `执行 node scripts/handoff-verify.mjs run，逐条执行 ${pending.id} 的验收步骤`,
        expected_evidence: `run 退出码 0，证据落在 .handoff/evidence/${sessionId}-${pending.id}-step-*.txt`,
      }
    : {
        feature_id: 'none',
        first_concrete_step: '人工验收：打开 .handoff/release-report.txt 并抽查一处 diff',
        expected_evidence: '放行报告结论为 PASS 且无越界项',
      };
  return packet;
};

/** clean_state：本模式不执行 git 操作，版本提交由使用者自行管理 */
export const writeCleanState = () => {
  writeJson(F_CLEAN, {
    blocking_issues: [],
    uncommitted_changes: '由使用者自行管理（本模式不执行 git 操作）',
    tests_runnable: true,
    working_directory_clean: true,
  });
};


