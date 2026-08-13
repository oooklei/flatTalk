// 本地生成 base64，SSH到远程用base64解码
const fs = require('fs');
const { execSync } = require('child_process');

const files = [
  { local: 'geographicSVG/巴马5天4晚康养旅居-丰富版.svg', remote: '/app/data/sojourn-maps/bama_5d4n/map_standard.svg' },
  { local: 'geographicSVG/防城港京族滨海文化线-丰富版.svg', remote: '/app/data/sojourn-maps/fcg_route_001/map_standard.svg' }
];

for (const { local, remote } of files) {
  const content = fs.readFileSync(local, 'utf8');
  const b64 = Buffer.from(content).toString('base64');
  
  // 写入远程服务器临时文件
  const tmpFile = '/tmp/svg_upload.b64';
  
  // 先清空
  execSync(`ssh root@192.168.1.2 "echo -n '' > ${tmpFile}"`, { encoding: 'utf8' });
  
  // 分块写入（避免命令行长度限制）
  const chunkSize = 500;
  for (let i = 0; i < b64.length; i += chunkSize) {
    const chunk = b64.slice(i, i + chunkSize);
    const cmd = `ssh root@192.168.1.2 "echo -n '${chunk}' >> ${tmpFile}"`;
    try {
      execSync(cmd, { encoding: 'utf8' });
    } catch (e) {
      console.error('chunk write failed:', e.message);
    }
  }
  
  // 解码并复制到容器
  const decodeCmd = `ssh root@192.168.1.2 "base64 -d ${tmpFile} > /tmp/svg_upload.svg && docker cp /tmp/svg_upload.svg flattalk2-app:${remote}"`;
  const result = execSync(decodeCmd, { encoding: 'utf8' });
  console.log(`${local} -> ${remote}: done`);
}

// 复制 bama 到 jtd_mock_bama_001
execSync(`ssh root@192.168.1.2 "docker exec flattalk2-app cp /app/data/sojourn-maps/bama_5d4n/map_standard.svg /app/data/sojourn-maps/jtd_mock_bama_001/map_standard.svg"`);

console.log('All SVG files synced');