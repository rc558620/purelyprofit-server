// 🚀 超简单 WebSocket 测试脚本（直接粘贴运行）
(function test() {
  console.log('🔍 Step 1: 检查 Token');
  const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
  
  if (!token) {
    console.error('❌ 没有 Token! 请先登录');
    return;
  }
  
  console.log('✅ Token 获取成功');
  
  console.log('\n🔍 Step 2: 加载 Socket.IO');
  
  const script = document.createElement('script');
  script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
  script.onload = function() {
    console.log('✅ Socket.IO 加载成功');
    
    setTimeout(() => {
      console.log('\n🔍 Step 3: 建立 WebSocket 连接');
      
      const socket = io('http://localhost:3000/scan-ordering', {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        upgrade: true,
        auth: { token }
      });
      
      socket.on('connect', () => {
        console.log('\n✅✅✅ SUCCESS! 连接成功!');
        console.log('Socket ID:', socket.id);
        
        const storeId = parseInt(localStorage.current_store_id || '0');
        if (storeId > 0) {
          console.log('\n📡 订阅门店:', storeId);
          socket.emit('subscribe.store', { storeId }, (r) => {
            if (r && r.room) {
              console.log('✅ 订阅成功:', r.room);
              console.log('\n🎯 现在可以测试订单事件了!');
            }
          });
        }
      });
      
      socket.on('connect_error', (err) => {
        console.error('\n❌ 连接失败:', err.message);
        console.log('\n💡 解决方案:');
        console.log('1. 确保后端已启动：cd server && pnpm run start:dev');
        console.log('2. 检查网络是否能访问 localhost:3000');
        console.log('3. Token 可能过期，重新登录');
      });
      
      socket.on('order.created', (data) => {
        console.log('\n🔔 收到新订单!', data);
      });
      
      socket.on('order.status_changed', (data) => {
        console.log('\n📊 订单状态更新!', data);
      });
      
    }, 500);
  };
  
  script.onerror = function() {
    console.error('❌ Socket.IO CDN 加载失败');
  };
  
  document.head.appendChild(script);
})();