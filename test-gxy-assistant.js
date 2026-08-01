/**
 * 测试 /gxy-assistant 端点
 * 生成加密的 userInfo 并发送请求
 */

import { encrypt } from './src/lib/h5-crypto.js';

const AES_KEY = 'tr6mxi9go1k9p63j';

// 构造测试用户信息
const userInfo = {
  userId: 'test_user_001',
  roleId: 'JIA_SHU',  // 家属角色
  userName: '测试用户',
  orgId: 'org_001',
  orgName: '测试机构',
  timestamp: Date.now(),
  nonce: `nonce_${Date.now()}_${Math.random().toString(36).slice(2)}`,
};

// 加密 userInfo
const cipherText = encrypt(JSON.stringify(userInfo), AES_KEY);

console.log('=== 测试 /gxy-assistant 端点 ===');
console.log('');
console.log('用户信息:');
console.log(JSON.stringify(userInfo, null, 2));
console.log('');
console.log('加密后的 userInfo:');
console.log(cipherText);
console.log('');

// 发送请求
const url = `http://127.0.0.1:5298/gxy-assistant?userInfo=${encodeURIComponent(cipherText)}`;
console.log('请求 URL:');
console.log(url);
console.log('');

// 使用 fetch 发送请求
fetch(url)
  .then(res => res.json())
  .then(data => {
    console.log('响应结果:');
    console.log(JSON.stringify(data, null, 2));
  })
  .catch(err => {
    console.error('请求失败:', err.message);
  });