// 自助下单建单链路的共享事实类型
//
// 建单编排（order.service）、幂等闸门（idempotency.service）与写入结构组装
// （order.writer）必须消费同一份「一次建单所需事实」，避免各自声明一份结构后漂移。
import type { CreateSelfOrderDto } from './dto/create-self-order.dto';
import type { SelfOrderPricingResult } from './club-self-ordering-pricing.service';

/** 通过四道门禁后的落库锚点（门店 / 会话 / 空间） */
export interface SelfOrderTarget {
  storeId: number;
  sessionId: number;
  spaceId: number;
}

/** 一次建单所需的全部事实：幂等键、入参、锚点、定价结果、订单号 */
export interface SelfOrderCreation {
  key: string;
  dto: CreateSelfOrderDto;
  target: SelfOrderTarget;
  priced: SelfOrderPricingResult;
  orderNo: string;
}
