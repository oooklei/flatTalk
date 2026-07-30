import http from 'node:http';
import crypto from 'node:crypto';

const appKey = 'rnOU1BN1qEnK4rlh';
const appSecret = 'uZBFfcdg8cKcv73uCfYtf9uM';
const timestamp = Date.now().toString();
const nonce = crypto.randomUUID().replace(/-/g, '');

// 签名方式: HMAC-SHA256(appSecret, appKey + timestamp + nonce + body + appSecret)
const body = '{}';
const signContent = appKey + timestamp + nonce + body + appSecret;
const sign = crypto.createHmac('sha256', appSecret).update(signContent, 'utf8').digest('hex');

const path = '/stage-api/sd/yz365/checkDetail';

const options = {
  hostname: '171.111.198.212',
  port: 9013,
  path: path,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json;charset=UTF-8',
    'Accept': 'application/json',
    'appKey': appKey,
    'timestamp': timestamp,
    'nonce': nonce,
    'sign': sign
  }
};

const req = http.request(options, (res) => {
  let respBody = '';
  res.on('data', chunk => respBody += chunk);
  res.on('end', () => {
    console.log(respBody);
  });
});

req.on('error', (e) => {
  console.error('Error:', e.message);
});

req.write(body);
req.end();