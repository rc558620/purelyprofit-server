-- 修正迁移: 使用 employee_shifts.employee_name 回填 sale_orders.operator_name_snapshot
-- 背景: 上一次迁移从 staffs.name 回填，但 staffs.name 已被级联更新为新昵称，
--       导致历史订单的操作员快照值是错误的（显示了新昵称而非创建时的旧昵称）。
--       employee_shifts.employee_name 在排班时写入，不受昵称级联更新影响，保留了当时的真实名称。

UPDATE "sale_orders" so
SET operator_name_snapshot = matched.employee_name
FROM (
  SELECT DISTINCT ON (sub_so.id) sub_so.id AS sale_order_id, es.employee_name
  FROM "sale_orders" sub_so
  JOIN "staffs" s ON sub_so.operator_staff_id = s.id
  JOIN "employees" e ON e.linked_staff_id = s.id
  JOIN "employee_shifts" es
    ON es.employee_id = e.id
    AND es.store_id = sub_so.store_id
    AND es.date = sub_so.date::date
    AND sub_so.date::time BETWEEN es.start_time::time AND es.end_time::time
  WHERE sub_so.operator_staff_id IS NOT NULL
  ORDER BY sub_so.id, es.id DESC
) matched
WHERE so.id = matched.sale_order_id;
