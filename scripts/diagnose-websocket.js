#!/usr/bin/env node
/**
 * PurelyProfit WebSocket 实时推送诊断工具
 * 
 * 使用方法:
 * 1. 在浏览器控制台执行这段代码
 * 2. 检查是否收到新订单和状态变更事件
 */

(function diagnoseWebSocket() {
  const SERVER_URL = 'http://localhost:3000';
  const WS_NAMESPACE = '/scan-ordering';
  
  console.log('🔍 开始诊断 WebSocket 连接...\n');

  // 获取 JWT Token
  const getAuthToken = () => {
    return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
  };

  const token = getAuthToken();
  if (!token) {
    console.error('❌ 缺少认证 Token，请先登录');
    return;
  }

  // 注入 Socket.IO
  const script = document.createElement('script');
  script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
  document.head.appendChild(script);

  setTimeout(() => {
    if (typeof io === 'undefined') {
      console.error('❌ Socket.IO 库加载失败');
      return;
    }

    // 创建连接
    let socket;
    try {
      socket = io(SERVER_URL, {
        path: `${WS_NAMESPACE}/socket.io/`,
        transports: ['websocket'],
        query: { 
          token,
          namespace: WS_NAMESPACE
        },
      });
    } catch (error) {
      console.error('❌ 连接失败:', error.message);
      return;
    }

    // 全局暴露（便于手动调试）
    window.scanOrderingSocket = socket;

    // 连接成功
    socket.on('connect', () => {
      console.log('✅ WebSocket 连接成功:', socket.id);
      
      // 订阅门店房间
      const storeId = parseInt(localStorage.getItem('current_store_id') || '0');
      if (!storeId) {
        console.warn('⚠️ 当前无门店 ID，无法订阅');
        return;
      }

      console.log(`📡 正在订阅门店：${storeId}`);
      socket.emit('subscribe.store', { storeId }, (response) => {
        if (response && response.room) {
          console.log(`✅ 订阅成功 - 房间：${response.room}`);
          console.log('\n🎯 监听事件...\n');
          
          printEventLog();
        } else if (response && response.error) {
          console.error('❌ 订阅失败:', response.error);
        } else {
          console.warn('⚠️ 订阅响应格式未知:', response);
        }
      });
    });

    // 错误处理
    socket.on('connect_error', (err) => {
      console.error('❌ 连接错误:', err.message);
    });

    // 监听订单创建事件
    socket.on('order.created', (payload) => {
      console.log('\n' + '='.repeat(60));
      console.log('🔔 新订单到达!');
      console.log('='.repeat(60));
      console.table(payload);
      console.log('-'.repeat(60) + '\n');
    });

    // 监听订单状态变更事件
    socket.on('order.status_changed', (payload) => {
      console.log('\n' + '='.repeat(60));
      console.log('📊 订单状态更新!');
      console.log('='.repeat(60));
      console.table({
        orderId: payload.orderId,
        status: payload.status,
        paymentStatus: payload.paymentStatus,
        fulfillmentStatus: payload.fulfillmentStatus,
        storeId: payload.storeId,
      });
      console.log('-'.repeat(60) + '\n');
    });

    // 监听断开连接
    socket.on('disconnect', (reason) => {
      console.log('🔴 WebSocket 断开:', reason);
    });

    // 打印事件日志频率
    setInterval(printEventLog, 5000);

  }, 500);

  function printEventLog() {
    const isConnected = typeof window.scanOrderingSocket !== 'undefined' &&
                        window.scanOrderingSocket.connected;
    
    if (isConnected) {
      console.log('🟢 实时状态：连接中 (最后 10s 内的事件见上方 Console)');
    } else {
      console.log('🔴 实时状态：未连接');
    }
  }

  // 提供诊断命令
  console.log('\n🛠️ 可用诊断命令:');
  console.log('   window.diagnose.checkConnection()     - 检查连接状态');
  console.log('   window.diagnose.subscribe(storeId)    - 手动订阅门店');
  console.log('   window.diagnose.triggerOrderTest()    - 模拟新订单推送');
  console.log('\n执行 "window.diagnose" 查看完整方法\n');
  
  // 暴露诊断 API
  window.diagnose = {
    checkConnection: () => {
      const s = window.scanOrderingSocket;
      if (!s) return { connected: false, message: '未初始化' };
      return {
        connected: s.connected,
        id: s.id,
        namespaces: Object.keys(s.nsmap),
        rooms: Array.from(s.rooms),
      };
    },

    subscribe: (storeId) => {
      if (!storeId) {
        console.error('请提供 storeId');
        return;
      }
      window.scanOrderingSocket.emit('subscribe.store', { storeId });
    },

    triggerOrderTest: () => {
      console.log('💡 触发测试事件...');
      window.scanOrderingSocket.emit('test.order.created', {
        orderId: Date.now(),
        storeId: 999,
        status: 'pending_payment',
      });
    },

    printEvents: () => {
      console.log('📊 当前连接信息:');
      console.table(window.diagnose.checkConnection());
    },
  };

})();
