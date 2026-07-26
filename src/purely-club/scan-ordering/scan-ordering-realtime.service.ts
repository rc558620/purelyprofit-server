import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

export const SCAN_ORDERING_NAMESPACE = '/scan-ordering';

@Injectable()
export class ScanOrderingRealtimeService {
  private server: Server | null = null;
  private readonly nativeOrderSubscribers = new Map<
    number,
    Set<(payload: unknown) => void>
  >();

  bindServer(server: Server): void {
    this.server = server;
  }

  publishOrderStatusChanged(payload: {
    storeId: number;
    orderId: number;
    sessionId: number | null;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
  }): void {
    this.publishToStore(payload.storeId, 'order.status_changed', payload);
    this.publishToOrder(payload.orderId, 'order.status_changed', payload);
    this.publishToNativeOrderSubscribers(payload.orderId, {
      type: 'order.status_changed',
      payload,
    });
    if (payload.sessionId) {
      this.server
        ?.to(this.sessionRoom(payload.sessionId))
        .emit('order.status_changed', payload);
    }
  }

  /**
   * 发布订单创建事件（通知 C 端订单房间、会话房间以及商家门店房间）。
   *
   * 订单创建后，商家端应实时收到通知以便及时准备接单。
   */
  publishOrderCreated(payload: {
    storeId: number;
    orderId: number;
    sessionId: number | null;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
  }): void {
    console.log('[RealtimeService] publishOrderCreated called:', {
      storeId: payload.storeId,
      orderId: payload.orderId,
      sessionId: payload.sessionId,
    });

    // 推送到商家门店房间（商家端订阅此房间）
    console.log('[RealtimeService] Publishing to store room:', payload.storeId);
    this.publishToStore(payload.storeId, 'order.created', payload);

    // 推送到订单房间（特定订单的详细信息页）
    this.publishToOrder(payload.orderId, 'order.status_changed', payload);

    // 推送到会话房间（C 端用户当前会话）
    if (payload.sessionId) {
      this.server
        ?.to(this.sessionRoom(payload.sessionId))
        .emit('order.status_changed', payload);
    }
  }

  publishServiceCallCreated(payload: {
    storeId: number;
    sessionId: number;
    serviceCallId: number;
    type: string;
    remark: string | null;
  }): void {
    this.publishToStore(payload.storeId, 'service_call.created', payload);
  }

  publishServiceCallUpdated(payload: {
    storeId: number;
    sessionId: number;
    serviceCallId: number;
    status: string;
  }): void {
    this.publishToStore(payload.storeId, 'service_call.updated', payload);
    this.server
      ?.to(this.sessionRoom(payload.sessionId))
      .emit('service_call.updated', payload);
  }

  subscribeNativeOrder(
    orderId: number,
    listener: (payload: unknown) => void,
  ): () => void {
    const listeners = this.nativeOrderSubscribers.get(orderId) ?? new Set();
    listeners.add(listener);
    this.nativeOrderSubscribers.set(orderId, listeners);
    return () => {
      const current = this.nativeOrderSubscribers.get(orderId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.nativeOrderSubscribers.delete(orderId);
    };
  }

  storeRoom(storeId: number): string {
    return `store:${storeId}`;
  }

  orderRoom(orderId: number): string {
    return `order:${orderId}`;
  }

  sessionRoom(sessionId: number): string {
    return `session:${sessionId}`;
  }

  private publishToNativeOrderSubscribers(
    orderId: number,
    message: unknown,
  ): void {
    for (const listener of this.nativeOrderSubscribers.get(orderId) ?? []) {
      listener(message);
    }
  }

  private publishToStore(
    storeId: number,
    event: string,
    payload: unknown,
  ): void {
    const room = this.storeRoom(storeId);
    const roomSockets =
      this.server?.sockets?.adapter?.rooms?.get(room) !== undefined
        ? Array.from(this.server.sockets.adapter.rooms.get(room) ?? [])
        : [];
    console.log('[RealtimeService] publishToStore:', {
      event,
      room,
      hasServer: !!this.server,
      roomSocketCount: roomSockets.length,
      roomSockets,
      payload,
    });
    this.server?.to(room).emit(event, payload);
  }

  private publishToOrder(
    orderId: number,
    event: string,
    payload: unknown,
  ): void {
    this.server?.to(this.orderRoom(orderId)).emit(event, payload);
  }
}
