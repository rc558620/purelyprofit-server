-- 门店服务人员（技师）称呼
--
-- 背景：非餐饮业态里「技师」是硬编码文案，美容/洗车等门店需要改成「美容师」「洗车工」。
-- 称呼要参与接口校验、导出表头与错误文案，且需按门店维度取值（多门店互不影响），
-- 因此存独立列而非 profileMetadata JSON。

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "technician_label" TEXT NOT NULL DEFAULT '技师';
