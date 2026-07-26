#!/bin/bash
# 🚀 一键 WebSocket 诊断脚本

echo "🔍 PurelyClub → PurelyProfit WebSocket 完整诊断"
echo "=========================================="
echo ""

# Step 1: 检查后端服务
echo "Step 1️⃣  检查后端服务..."
PROCESS_COUNT=$(ps aux | grep "[n]ode.*purelyprofit" | wc -l | tr -d ' ')
if [ "$PROCESS_COUNT" -gt 0 ]; then
    echo "✅ 后端服务正在运行 (进程数：$PROCESS_COUNT)"
else
    echo "❌ 后端服务未运行!"
    echo "   请执行：cd /Users/f0rest/Mac/project/React/purelyprofit-server && pnpm run start:dev"
    exit 1
fi
echo ""

# Step 2: 检查端口监听
echo "Step 2️⃣  检查端口 3000..."
if lsof -i :3000 | grep LISTEN > /dev/null 2>&1; then
    echo "✅ 端口 3000 正在监听"
    lsof -i :3000 | grep LISTEN | head -1
else
    echo "❌ 端口 3000 未被占用"
fi
echo ""

# Step 3: 测试 HTTP API
echo "Step 3️⃣  测试 HTTP API..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api-docs 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ HTTP API 正常 (Status: $HTTP_STATUS)"
elif [ "$HTTP_STATUS" = "000" ]; then
    echo "❌ 无法连接到后端"
else
    echo "⚠️  HTTP API 响应异常 (Status: $HTTP_STATUS)"
fi
echo ""

# Step 4: 检查 IoAdapter 配置
echo "Step 4️⃣  检查 IoAdapter 配置..."
if grep -q "useWebSocketAdapter" src/bootstrap/bootstrap.ts; then
    echo "✅ IoAdapter 已在 bootstrap.ts 中配置"
    
    if grep -q "IoAdapter" dist/src/bootstrap/bootstrap.js; then
        echo "✅ IoAdapter 已编译到 dist 目录"
    else
        echo "⚠️  IoAdapter 未编译，请执行：npm run build"
    fi
else
    echo "❌ IoAdapter 配置缺失"
fi
echo ""

# Step 5: 检查 Gateway 定义
echo "Step 5️⃣  检查 WebSocket Gateway..."
if grep -q "@WebSocketGateway" src/purely-club/scan-ordering/scan-ordering.gateway.ts; then
    NAMESPACE=$(grep "namespace:" src/purely-club/scan-ordering/scan-ordering.gateway.ts | head -1 | cut -d"'" -f2)
    echo "✅ Gateway 定义存在"
    echo "   Namespace: $NAMESPACE"
else
    echo "❌ Gateway 定义缺失"
fi
echo ""

# Step 6: 检查 Module 注册
echo "Step 6️⃣  检查 Module 注册..."
if grep -q "ClubScanOrderingModule" src/app.module.ts; then
    echo "✅ ClubScanOrderingModule 已注册"
else
    echo "❌ ClubScanOrderingModule 未注册"
fi
echo ""

# Step 7: 创建浏览器测试脚本
echo "Step 7️⃣  生成浏览器测试脚本..."
cat > /tmp/ws-browser-test.js << 'EOF'
// 🚀 浏览器 Console 直接运行此脚本
(function() {
  console.log('\n=== PurelyClub WebSocket 测试 ===\n');
  
  // Step 1: Token
  const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
  if (!token) { 
    console.error('❌ 请先登录'); 
    return; 
  }
  console.log('✅ Token:', token.substring(0, 30) + '...');
  
  // Step 2: 本地 Socket.IO (不用 CDN)
  const script = document.createElement('script');
  script.src = 'http://localhost:3000/socket.io/socket.io.js'; // 尝试从后端加载
  script.onerror = function() {
    console.warn('⚠️  后端 Socket.IO 客户端不可用，尝试 CDN');
    script.src = 'https://unpkg.com/socket.io@4.7.2/dist/socket.io.min.js';
    document.head.appendChild(script);
  };
  
  script.onload = function() {
    if (typeof io === 'undefined') {
      console.error('❌ Socket.IO 加载失败');
      return;
    }
    
    console.log('✅ Socket.IO 加载成功\n');
    
    // Step 3: 连接
    console.log('📡 尝试连接...\n');
    
    const socket = io('http://localhost:3000', {
      path: '/scan-ordering/socket.io/',
      transports: ['websocket'],
      query: { token: token }
    });
    
    socket.on('connect', () => {
      console.log('\n✅✅✅ 连接成功!');
      console.log('Socket ID:', socket.id);
      
      const storeId = parseInt(localStorage.current_store_id || '0');
      if (storeId > 0) {
        console.log('\n📡 订阅门店:', storeId);
        socket.emit('subscribe.store', { storeId }, (r) => {
          if (r && r.room) {
            console.log('✅ 订阅成功:', r.room);
            console.log('\n🎯 现在可以测试订单推送了!');
            console.log('\n请用小程序下单，这里会实时显示订单事件\n');
          }
        });
      }
    });
    
    socket.on('connect_error', (err) => {
      console.error('\n❌ 连接失败:', err.message);
      console.log('\n💡 建议检查:');
      console.log('1. 后端服务是否运行：ps aux | grep purelyprofit');
      console.log('2. Token 是否有效：重新登录');
      console.log('3. 网络访问：curl http://localhost:3000/');
    });
    
    socket.on('order.created', (data) => {
      console.log('\n🔔 新订单:', data);
    });
    
    socket.on('order.status_changed', (data) => {
      console.log('\n📊 状态更新:', data);
    });
  };
  
  document.head.appendChild(script);
})();
EOF

echo "✅ 已生成测试脚本：/tmp/ws-browser-test.js"
echo ""

# Step 8: 提供浏览器测试命令
echo "=========================================="
echo "🎯 下一步操作:"
echo "=========================================="
echo ""
echo "1. 打开浏览器 (F12 → Console)"
echo ""
echo "2. 复制下面的代码并粘贴到 Console:"
echo ""
echo "   cat /tmp/ws-browser-test.js | pbcopy"
echo ""
echo "   这会把脚本复制到剪贴板，然后在 Console 中粘贴运行"
echo ""
echo "3. 预期输出:"
echo "   ✅ Token: <token>..."
echo "   ✅ Socket.IO 加载成功"
echo "   ✅✅✅ 连接成功!"
echo "   📡 订阅门店：456"
echo "   ✅ 订阅成功：store:456"
echo "   🎯 现在可以测试订单推送了!"
echo ""
echo "4. 然后用小程序下单，Console 会实时显示订单事件"
echo ""
echo "=========================================="
echo "如仍有问题，请提供完整的 Console 输出截图"
echo "=========================================="
