/**
 * 从 flatTalk-dashboard 复刻景点实拍照片到 flatTalk/data/spot-images/
 * 并重建 dashboard-spot-images.json 索引（真实图片路径替换SVG占位符）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLATTALK_ROOT = path.resolve(__dirname, '..');
const DASHBOARD_ROOT = path.resolve(__dirname, '../../flatTalk-dashboard');

const SPOTS_SRC = path.join(DASHBOARD_ROOT, 'public', 'images', 'spots');
const SPOTS_DST = path.join(FLATTALK_ROOT, 'data', 'spot-images');
const KNOW_DIR = path.join(FLATTALK_ROOT, 'src', 'skills', 'travel_route', 'knowledge');
const INDEX_FILE = path.join(KNOW_DIR, 'dashboard-spot-images.json');

// 1. 复制景点照片
console.log('== 1. 复制景点照片 ==');
console.log(`源: ${SPOTS_SRC}`);
console.log(`目标: ${SPOTS_DST}`);

if (!fs.existsSync(SPOTS_SRC)) {
  console.error('ERROR: flatTalk-dashboard spots 目录不存在');
  process.exit(1);
}

// 清空目标
if (fs.existsSync(SPOTS_DST)) {
  fs.rmSync(SPOTS_DST, { recursive: true });
}
fs.mkdirSync(SPOTS_DST, { recursive: true });

// 复制每个景点目录
const spotDirs = fs.readdirSync(SPOTS_SRC).filter(d =>
  fs.statSync(path.join(SPOTS_SRC, d)).isDirectory(),
);
let totalPhotos = 0;
const spotMap = {}; // {景点名: [相对路径]}

for (const spotName of spotDirs) {
  const srcDir = path.join(SPOTS_SRC, spotName);
  const dstDir = path.join(SPOTS_DST, spotName);
  fs.mkdirSync(dstDir, { recursive: true });

  const photos = fs.readdirSync(srcDir).filter(f =>
    /\.(jpg|jpeg|png)$/i.test(f),
  );

  for (const photo of photos) {
    fs.copyFileSync(path.join(srcDir, photo), path.join(dstDir, photo));
  }

  if (photos.length > 0) {
    spotMap[spotName] = photos.map(p => `data/spot-images/${spotName}/${p}`);
    totalPhotos += photos.length;
  }
}
console.log(`复制完成: ${spotDirs.length} 个景点, ${totalPhotos} 张照片`);

// 2. 读取现有索引
console.log('\n== 2. 重建 dashboard-spot-images.json ==');
const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));

function norm(s) {
  return String(s || '')
    .replace(/[（(].*/, '')
    .replace(/\s+/g, '')
    .replace(/景区|风景区|公园|古镇|口岸|基地|旅居/g, '')
    .trim();
}

function nameMatch(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

// 3. 用真实照片替换 SVG 占位符
let replaced = 0;
let unchanged = 0;
let newlyLinked = 0;

for (const endpoint of index.endpoints) {
  // 在 spotMap 中查找匹配的景点
  const matchedSpot = Object.keys(spotMap).find(spotName =>
    nameMatch(endpoint.name, spotName) || nameMatch(spotName, endpoint.name),
  );

  if (matchedSpot && spotMap[matchedSpot].length > 0) {
    const oldSource = endpoint.image_source;
    endpoint.spot_images = spotMap[matchedSpot];
    endpoint.image_source = 'dashboard_photo';
    if (oldSource !== 'dashboard_photo') {
      replaced++;
    } else {
      unchanged++;
    }
  }
}

// 4. 为 spotMap 中未出现在 index.endpoints 的景点添加条目
const existingNames = index.endpoints.map(e => e.name);
for (const [spotName, photos] of Object.entries(spotMap)) {
  const exists = existingNames.some(n => nameMatch(n, spotName));
  if (!exists) {
    index.endpoints.push({
      name: spotName,
      city: '',
      lat: 0,
      lng: 0,
      spot_images: photos,
      spot_desc: '',
      related_spots: [],
      image_source: 'dashboard_photo',
    });
    newlyLinked++;
  }
}

index.photo_count = index.endpoints.filter(e =>
  e.image_source === 'dashboard_photo' && e.spot_images?.length > 0,
).length;
index.poster_count = index.endpoints.filter(e =>
  e.image_source !== 'dashboard_photo',
).length;
index.generated_at = new Date().toISOString();
index.source += ' + dashboard real photos';

fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
console.log(`替换SVG占位符: ${replaced} 个`);
console.log(`已有真实图(不变): ${unchanged} 个`);
console.log(`新增景点条目: ${newlyLinked} 个`);
console.log(`最终: ${index.endpoints.length} 端点, ${index.photo_count} 有真实图, ${index.poster_count} 用占位符`);

console.log('\n[完成]');
