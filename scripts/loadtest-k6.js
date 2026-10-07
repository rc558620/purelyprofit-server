/**
 * k6 压测场景脚本 — DB 优化上线前压测
 *
 * 用法：
 *   k6 run scripts/loadtest-k6.js
 *
 * 环境变量（通过 k6 -e 传入或 shell export）：
 *   LOADTEST_BASE_URL    被测服务地址（默认 http://localhost:3000/api）
 *   LOADTEST_B_TOKEN     商家端 JWT token
 *   LOADTEST_C_TOKEN     C 端会员 JWT token
 *   LOADTEST_STORE_ID    目标门店 ID（商家端场景用）
 *   LOADTEST_SESSION_ID  C 端扫码会话 ID
 *   LOADTEST_PULSE_TOKEN Pulse 平台端 JWT token
 *   LOADTEST_TIER        压测档位 'A'（~25 QPS）或 'B'（~115 QPS），默认 B
 *
 * 前置环境前提（不满足则结果无意义）：
 *   1. PG 连接数 < 50（确认无残留连接）
 *   2. IOPS await < 20ms（磁盘无积压）
 *   3. Redis 连通且 maxmemory=1GB 已设
 *   4. 缓存预热已完成（等待 ~30s 让 prewarm-cycle 填充热 key）
 *   5. 压测数据已通过 seed-loadtest-*.mjs 构造完毕
 *   6. I1~I7/I9 所有变更已部署（参数+索引+代码+缓存+清理任务）
 *
 * 达标线（所有场景）：
 *   - P95 ≤ 300ms
 *   - P99 ≤ 500ms
 *   - 错误率 < 0.1%
 *
 * 观测口径：
 *   应用侧：慢 SQL 80ms 告警、慢请求 800ms、PoolTimeout
 *   数据库侧：pg_stat_activity active、pg_locks not granted、IOPS await、缓存命中率
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.LOADTEST_BASE_URL || 'http://localhost:3000/api';
const B_TOKEN = __ENV.LOADTEST_B_TOKEN || '';
const C_TOKEN = __ENV.LOADTEST_C_TOKEN || '';
const STORE_ID = __ENV.LOADTEST_STORE_ID || '1';
const SESSION_ID = __ENV.LOADTEST_SESSION_ID || '1';
const PULSE_TOKEN = __ENV.LOADTEST_PULSE_TOKEN || '';
const TIER = (__ENV.LOADTEST_TIER || 'B').toUpperCase();

// 档位 QPS 配置
const TIER_CONFIG = {
  A: {
    // 档 A：100 店 / ~25 QPS
    s1_sales_record: 3,
    s2_business_analysis: 2,
    s3_profit_detail: 2,
    s4_scan_menu: 8,
    s5_member_snapshot: 8,
    s6_order_list: 5,
    s7_pulse: 1,
    s8_mixed: 25,
  },
  B: {
    // 档 B：500 店 / ~115 QPS
    s1_sales_record: 8,
    s2_business_analysis: 5,
    s3_profit_detail: 5,
    s4_scan_menu: 15,
    s5_member_snapshot: 15,
    s6_order_list: 10,
    s7_pulse: 1,
    s8_mixed: 115,
  },
};

const QPS = TIER_CONFIG[TIER] || TIER_CONFIG.B;

// 自定义指标
const errorRate = new Rate('errors');
const dbQueryDuration = new Trend('db_query_duration', true);

// ── 场景定义 ──────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // 场景 1：商家端销售记录列表
    s1_sales_record: {
      executor: 'ramping-vus',
      exec: 's1_sales_record',
      startVUs: 0,
      stages: [
        { duration: '30s', target: QPS.s1_sales_record },
        { duration: '120s', target: QPS.s1_sales_record },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },

    // 场景 2：商家端经营分析（business-analysis）
    s2_business_analysis: {
      executor: 'ramping-vus',
      exec: 's2_business_analysis',
      startVUs: 0,
      stages: [
        { duration: '30s', target: QPS.s2_business_analysis },
        { duration: '120s', target: QPS.s2_business_analysis },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
      startTime: '5s',
    },

    // 场景 3：商家端利润详情
    s3_profit_detail: {
      executor: 'ramping-vus',
      exec: 's3_profit_detail',
      startVUs: 0,
      stages: [
        { duration: '30s', target: QPS.s3_profit_detail },
        { duration: '120s', target: QPS.s3_profit_detail },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
      startTime: '10s',
    },

    // 场景 4：C 端扫码菜单
    s4_scan_menu: {
      executor: 'ramping-vus',
      exec: 's4_scan_menu',
      startVUs: 0,
      stages: [
        { duration: '30s', target: QPS.s4_scan_menu },
        { duration: '120s', target: QPS.s4_scan_menu },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
      startTime: '15s',
    },

    // 场景 5：C 端会员快照
    s5_member_snapshot: {
      executor: 'ramping-vus',
      exec: 's5_member_snapshot',
      startVUs: 0,
      stages: [
        { duration: '30s', target: QPS.s5_member_snapshot },
        { duration: '120s', target: QPS.s5_member_snapshot },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
      startTime: '20s',
    },

    // 场景 6：C 端订单列表
    s6_order_list: {
      executor: 'ramping-vus',
      exec: 's6_order_list',
      startVUs: 0,
      stages: [
        { duration: '30s', target: QPS.s6_order_list },
        { duration: '120s', target: QPS.s6_order_list },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
      startTime: '25s',
    },

    // 场景 7：Pulse dashboard
    s7_pulse: {
      executor: 'ramping-vus',
      exec: 's7_pulse',
      startVUs: 0,
      stages: [
        { duration: '30s', target: QPS.s7_pulse },
        { duration: '120s', target: QPS.s7_pulse },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
      startTime: '30s',
    },

    // 场景 8：混合峰值（S1+S4+S5 并行，模拟真实流量峰值）
    s8_mixed_peak: {
      executor: 'ramping-vus',
      exec: 's8_mixed_peak',
      startVUs: 0,
      stages: [
        { duration: '30s', target: QPS.s8_mixed },
        { duration: '120s', target: QPS.s8_mixed },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
      startTime: '170s', // 等前 7 个场景结束后再跑混合峰值
    },
  },
  thresholds: {
    // 全局达标线
    http_req_duration: ['p(95)<300', 'p(99)<500'],
    http_req_failed: ['rate<0.001'],
    errors: ['rate<0.001'],
  },
};

// ── 请求函数 ──────────────────────────────────────────────────────

function bHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${B_TOKEN}`,
  };
}

function cHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${C_TOKEN}`,
  };
}

function pulseHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${PULSE_TOKEN}`,
  };
}

function doCheck(res, scenarioName) {
  const ok = check(res, {
    [`${scenarioName}: status 200`]: (r) => r.status === 200,
    [`${scenarioName}: has body`]: (r) => r.body && r.body.length > 0,
  });
  errorRate.add(!ok);
  dbQueryDuration.add(res.timings.waiting, { scenario: scenarioName });
  return ok;
}

// ── 场景实现 ──────────────────────────────────────────────────────

// S1：商家端销售记录列表
export function s1_sales_record() {
  group('S1 sales-record list', () => {
    const res = http.get(
      `${BASE_URL}/profit/sales-record/list?storeId=${STORE_ID}&page=1&pageSize=20`,
      { headers: bHeaders() },
    );
    doCheck(res, 's1_sales_record');
  });
  sleep(1);
}

// S2：商家端经营分析
export function s2_business_analysis() {
  group('S2 business-analysis', () => {
    const res = http.get(
      `${BASE_URL}/profit/business-analysis/overview?storeId=${STORE_ID}&period=month`,
      { headers: bHeaders() },
    );
    doCheck(res, 's2_business_analysis');
  });
  sleep(1);
}

// S3：商家端利润详情
export function s3_profit_detail() {
  group('S3 profit-detail', () => {
    const res = http.get(
      `${BASE_URL}/profit-detail/report?storeId=${STORE_ID}&period=month`,
      { headers: bHeaders() },
    );
    doCheck(res, 's3_profit_detail');
  });
  sleep(1);
}

// S4：C 端扫码菜单
export function s4_scan_menu() {
  group('S4 scan-menu', () => {
    const res = http.get(
      `${BASE_URL}/club/scan-ordering/menu?sessionId=${SESSION_ID}`,
      { headers: cHeaders() },
    );
    doCheck(res, 's4_scan_menu');
  });
  sleep(1);
}

// S5：C 端会员快照
export function s5_member_snapshot() {
  group('S5 member-snapshot', () => {
    const res = http.get(
      `${BASE_URL}/club/member/snapshot`,
      { headers: cHeaders() },
    );
    doCheck(res, 's5_member_snapshot');
  });
  sleep(1);
}

// S6：C 端订单列表
export function s6_order_list() {
  group('S6 order-list', () => {
    const res = http.get(
      `${BASE_URL}/club/orders?page=1&pageSize=20`,
      { headers: cHeaders() },
    );
    doCheck(res, 's6_order_list');
  });
  sleep(1);
}

// S7：Pulse dashboard
export function s7_pulse() {
  group('S7 pulse-dashboard', () => {
    const res = http.get(
      `${BASE_URL}/pulse/dashboard/home`,
      { headers: pulseHeaders() },
    );
    doCheck(res, 's7_pulse');
  });
  sleep(1);
}

// S8：混合峰值（C 端 ~70%：菜单+快照+订单，B 端 ~30%：销售记录+经营分析）
export function s8_mixed_peak() {
  const roll = Math.random();
  if (roll < 0.35) {
    // C 端扫码菜单 ~35%
    group('S8-mixed scan-menu', () => {
      const res = http.get(
        `${BASE_URL}/club/scan-ordering/menu?sessionId=${SESSION_ID}`,
        { headers: cHeaders() },
      );
      doCheck(res, 's8_mixed_scan_menu');
    });
  } else if (roll < 0.60) {
    // C 端会员快照 ~25%
    group('S8-mixed member-snapshot', () => {
      const res = http.get(`${BASE_URL}/club/member/snapshot`, {
        headers: cHeaders(),
      });
      doCheck(res, 's8_mixed_member_snapshot');
    });
  } else if (roll < 0.70) {
    // C 端订单列表 ~10%
    group('S8-mixed order-list', () => {
      const res = http.get(`${BASE_URL}/club/orders?page=1&pageSize=20`, {
        headers: cHeaders(),
      });
      doCheck(res, 's8_mixed_order_list');
    });
  } else if (roll < 0.85) {
    // B 端销售记录 ~15%
    group('S8-mixed sales-record', () => {
      const res = http.get(
        `${BASE_URL}/profit/sales-record/list?storeId=${STORE_ID}&page=1&pageSize=20`,
        { headers: bHeaders() },
      );
      doCheck(res, 's8_mixed_sales_record');
    });
  } else {
    // B 端经营分析 ~15%
    group('S8-mixed business-analysis', () => {
      const res = http.get(
        `${BASE_URL}/profit/business-analysis/overview?storeId=${STORE_ID}&period=month`,
        { headers: bHeaders() },
      );
      doCheck(res, 's8_mixed_business_analysis');
    });
  }
  sleep(1);
}

// ── 输出汇总 ──────────────────────────────────────────────────────
export function handleSummary(data) {
  const summary = {
    tier: TIER,
    scenarios: {},
    thresholds: data.metrics.http_req_duration?.thresholds || {},
    total_requests: data.metrics.http_reqs?.count || 0,
    error_rate: data.metrics.errors?.rate || 0,
  };

  for (const [name, scenario] of Object.entries(data.scenarios || {})) {
    summary.scenarios[name] = {
      requests: scenario.iterations_completed || 0,
      failures: scenario.fails || 0,
    };
  }

  return {
    stdout: JSON.stringify(summary, null, 2),
  };
}
