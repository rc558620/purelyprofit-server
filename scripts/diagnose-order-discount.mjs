// 诊断：最近扫码订单的 discountAmount 计算
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const res = await pool.query(
    `SELECT id, order_no, item_original_amount, specification_extra_amount,
            product_discount_amount, order_discount_amount,
            service_fee_amount, tax_amount, payable_amount, paid_amount,
            marketing_snapshot, created_at
     FROM scan_orders
     WHERE deleted_at IS NULL
     ORDER BY id DESC LIMIT 5`,
  );
  for (const r of res.rows) {
    const snap = typeof r.marketing_snapshot === 'string' ? JSON.parse(r.marketing_snapshot) : r.marketing_snapshot;
    const pointsDeduct = snap?.pointsDeductAmount ?? 0;
    const original = (r.item_original_amount ?? 0) + (r.specification_extra_amount ?? 0);
    const nonDiscountExtras = (r.service_fee_amount ?? 0) + (r.tax_amount ?? 0);
    const subtractive = original - (r.payable_amount ?? 0) - nonDiscountExtras;
    const additive = (r.product_discount_amount ?? 0) + (r.order_discount_amount ?? 0) + pointsDeduct;
    console.log(JSON.stringify({
      id: r.id,
      orderNo: r.order_no,
      原价: original,
      productDiscount: r.product_discount_amount,
      orderDiscount: r.order_discount_amount,
      pointsDeduct,
      payableAmount: r.payable_amount,
      减法公式: subtractive,
      加法公式: additive,
      最终discount: Math.min(Math.max(subtractive, additive), original),
    }));
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
