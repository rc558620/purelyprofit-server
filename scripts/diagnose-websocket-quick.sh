#!/bin/bash
# PurelyClub ↔ PurelyProfit WebSocket 快速诊断脚本

echo "🔍 PurelyClub → PurelyProfit 通信诊断"
echo "========================================"
echo ""

# Step 1: 检查后端服务状态
echo "Step 1️⃣ 检查后端服务..."
if pgrep -f "purelyprofit-server.*main" > /dev/null; then
    echo "✅ 后端服务正在运行"
    PROCESS_COUNT=$(ps aux | grep "[n]ode.*purelyprofit" | wc -l)
    echo "   进程数：$PROCESS_COUNT"
else
    echo "❌ 后端服务未运行！"
    echo "💡 请执行：cd /Users/f0rest/Mac/project/React/purelyprofit-server && pnpm run start:dev"
    exit 1
fi
echo ""

# Step 2: 检查端口监听
echo "Step 2️⃣ 检查端口 3000..."
PORT_LISTENING=$(lsof -i :3000 | grep LISTEN | wc -l)
if [ $PORT_LISTENING -gt 0 ]; then
    echo "✅ 端口 3000 正在监听"
    lsof -i :3000 | head -3
else
    echo "❌ 端口 3000 未被占用"
fi
echo ""

# Step 3: 检查 API 可访问性
echo "Step 3️⃣ 测试 API 连通性..."
API_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api-docs 2>/dev/null)
if [ "$API_RESPONSE" = "200" ]; then
    echo "✅ HTTP API 可访问 (Status: $API_RESPONSE)"
elif [ "$API_RESPONSE" = "404" ]; then
    echo "⚠️  HTTP API 有响应但路径不存在 (Status: $API_RESPONSE)"
else
    echo "❌ HTTP API 无响应 (Status: $API_RESPONSE)"
fi
echo ""

# Step 4: 检查 WebSocket Gateway 定义
echo "Step 4️⃣ 检查 WebSocket Gateway 定义..."
GATEWAY_FILE="src/purely-club/scan-ordering/scan-ordering.gateway.ts"
if [ -f "$GATEWAY_FILE" ]; then
    NAMESPACE=$(grep "namespace:" "$GATEWAY_FILE" | grep -o "'[^']*'" | tr -d "'")
    if [ -n "$NAMESPACE" ]; then
        echo "✅ Gateway 定义存在"
        echo "   Namespace: $NAMESPACE"
    else
        echo "⚠️  Namespace 配置可能有问题"
    fi
else
    echo "❌ Gateway 文件不存在"
fi
echo ""

# Step 5: 检查 IoAdapter 配置
echo "Step 5️⃣ 检查 IoAdapter 配置..."
BOOTSTRAP_TS="src/bootstrap/bootstrap.ts"
if grep -q "IoAdapter" "$BOOTSTRAP_TS"; then
    echo "✅ IoAdapter 导入已添加"
    
    if grep -q "useWebSocketAdapter" "$BOOTSTRAP_TS"; then
        echo "✅ useWebSocketAdapter 调用已添加"
    else
        echo "⚠️  useWebSocketAdapter 调用缺失"
    fi
else
    echo "❌ IoAdapter 导入缺失"
fi
echo ""

# Step 6: 检查 Module 注册
echo "Step 6️⃣ 检查 Module 注册..."
APP_MODULE="src/app.module.ts"
if grep -q "ClubScanOrderingModule" "$APP_MODULE"; then
    LINE_NUMBER=$(grep -n "ClubScanOrderingModule" "$APP_MODULE" | tail -1 | cut -d: -f1)
    echo "✅ ClubScanOrderingModule 已注册"
    echo "   行号：$LINE_NUMBER"
else
    echo "❌ ClubScanOrderingModule 未注册"
fi
echo ""

# Step 7: 检查 TypeScript 编译状态
echo "Step 7️⃣ 检查编译状态..."
if [ -d "dist" ]; then
    echo "✅ dist 目录存在"
    
    # 查找是否包含 IoAdapter 引用
    if grep -r "IoAdapter" dist/bootstrap/*.js 2>/dev/null | head -1; then
        echo "✅ IoAdapter 已在编译后文件中"
    else
        echo "⚠️  IoAdapter 可能在编译后被优化掉了"
    fi
    
    # 检查文件大小
    COMPILED_SIZE=$(ls -lh dist/main.js 2>/dev/null | awk '{print $5}')
    echo "   main.js 大小：$COMPILED_SIZE"
else
    echo "❌ dist 目录不存在（需要运行 npm run build）"
fi
echo ""

# Step 8: 总结建议
echo "========================================"
echo "📋 下一步操作建议:"
echo "========================================"
echo ""
echo "1️⃣ 如果以上检查全部通过 ✅："
echo "   → 问题很可能在**前端**（没有 WebSocket 监听）"
echo "   → 请在浏览器 Console 执行诊断脚本："
echo "      curl -o /tmp/ws-test.js https://raw.githubusercontent.com/example/scripts/diagnose-websocket.js"
echo "      cat /tmp/ws-test.js | pbcopy && echo '已复制到剪贴板，粘贴到浏览器 Console 运行'"
echo ""
echo "2️⃣ 如果有检查失败 ❌："
echo "   → 请查看上面的具体错误提示并修复"
echo "   → 常见原因："
echo "     • 后端服务未启动（执行 pnpm run start:dev）"
echo "     • IoAdapter 未配置（手动编辑 bootstrap.ts 添加）"
echo "     • Module 未导入（手动编辑 app.module.ts 添加）"
echo "     • TypeScript 未编译（执行 npm run build）"
echo ""
echo "3️⃣ 想立即看到效果？"
echo "   → 重启后端服务:"
echo "     killall -9 node && cd server && pnpm run start:dev"
echo "   → 打开浏览器 F12 Console，查看日志输出"
echo "   → 用小程序下单，观察商家端 Console 是否有事件接收"
echo ""
echo "========================================"
echo "诊断完成！如仍有问题，请提供此输出的截图"
echo "========================================"
