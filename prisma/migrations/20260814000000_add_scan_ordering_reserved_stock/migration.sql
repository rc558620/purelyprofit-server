-- 扫码点餐库存预留机制：为菜单商品与规格选项新增预留库存字段
-- 语义：reserved_quantity = 已下单未接单的预留量；接单确认后扣减，取消/拒单时释放

-- 菜单商品表：新增预留库存字段
ALTER TABLE "scan_ordering_menu_products" ADD COLUMN "reserved_quantity" INTEGER NOT NULL DEFAULT 0;

-- 规格选项表：新增预留库存字段
ALTER TABLE "scan_ordering_spec_options" ADD COLUMN "reserved_quantity" INTEGER NOT NULL DEFAULT 0;
