import type { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { RedisOpsContext } from './redis-command-observer';

/** 发布消息，返回收到该消息的订阅者数量 */
export const publishMessage = (
  ops: RedisOpsContext,
  channel: string,
  message: string,
): Promise<number> =>
  ops.observe('PUBLISH', () => ops.client.publish(channel, message));

/** 为发布 / 订阅创建独立连接（订阅连接不能复用普通命令连接） */
export const duplicatePubSubClients = (
  client: Redis,
): { publisher: Redis; subscriber: Redis } => ({
  publisher: client.duplicate(),
  subscriber: client.duplicate(),
});

/** 订阅频道，返回取消订阅并释放连接的函数 */
export const subscribeChannel = async (
  client: Redis,
  logger: Logger,
  channel: string,
  listener: (message: string) => void,
): Promise<() => Promise<void>> => {
  const subscriber = client.duplicate();
  const handleMessage = (receivedChannel: string, message: string): void => {
    if (receivedChannel === channel) listener(message);
  };

  subscriber.on('error', (error: Error) => {
    logger.error(`[redis] subscriber error: ${error.message}`, error.stack);
  });
  subscriber.on('message', handleMessage);
  await subscriber.subscribe(channel);

  return async () => {
    subscriber.off('message', handleMessage);
    await subscriber.unsubscribe(channel);
    await subscriber.quit();
  };
};
