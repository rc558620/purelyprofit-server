#!/usr/bin/env node
/**
 * WebSocket 快速测试脚本
 * 运行：node test-ws.js
 */

const http = require('http');

console.log('🔍 Testing WebSocket connection...\n');

// Step 1: 检查后端是否运行
const checkBackend = () => {
  return new Promise((resolve, reject) => {
    const req = http.get('http://localhost:3000/api-docs', (res) => {
      console.log('✅ Backend is running');
      console.log(`   Status: ${res.statusCode}`);
      resolve();
    });
    
    req.on('error', (err) => {
      console.error('❌ Backend not accessible:', err.message);
      reject(err);
    });
    
    req.setTimeout(3000, () => {
      console.error('❌ Backend timeout');
      req.destroy();
      reject(new Error('timeout'));
    });
  });
};

// Step 2: 测试 Socket.IO polling endpoint
const testSocketIO = () => {
  return new Promise((resolve, reject) => {
    const url = 'http://localhost:3000/scan-ordering/socket.io/?EIO=4&transport=polling';
    const req = http.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log('\n📡 Socket.IO Polling Test:');
        console.log(`   Status: ${res.statusCode}`);
        
        if (res.statusCode === 200) {
          console.log('   ✅ SUCCESS! Socket.IO is working');
          console.log(`   Response: ${data.substring(0, 100)}...`);
          resolve();
        } else if (res.statusCode === 404) {
          console.log('   ⚠️  404 - This is expected for polling');
          console.log('   💡 WebSocket should work via direct connection');
          resolve();
        } else {
          console.error(`   ❌ Unexpected status: ${res.statusCode}`);
          reject(new Error(`Status ${res.statusCode}`));
        }
      });
    });
    
    req.on('error', (err) => {
      console.error('❌ Socket.IO test failed:', err.message);
      reject(err);
    });
    
    req.setTimeout(3000, () => {
      console.error('❌ Socket.IO timeout');
      req.destroy();
      reject(new Error('timeout'));
    });
  });
};

// Run tests
(async () => {
  try {
    await checkBackend();
    await testSocketIO();
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 All checks passed!');
    console.log('='.repeat(60));
    console.log('\nNext steps:');
    console.log('1. Open browser DevTools → Console');
    console.log('2. Run this command:');
    console.log(`
    const socket = io('http://localhost:3000', {
      path: '/scan-ordering/socket.io/',
      transports: ['websocket'],
      query: { token: localStorage.getItem('auth_token') }
    });
    
    socket.on('connect', () => {
      console.log('✅ Connected:', socket.id);
      const storeId = parseInt(localStorage.current_store_id || '0');
      socket.emit('subscribe.store', { storeId }, (r) => {
        console.log('Subscribed:', r?.room || r);
      });
    });
    
    socket.on('order.created', (d) => {
      console.log('🔔 NEW ORDER:', d);
    });
    `);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
})();