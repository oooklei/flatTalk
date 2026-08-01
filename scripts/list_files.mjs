import fs from 'fs';
import path from 'path';

const SOURCE_DIR = 'D:\\GuiCare\\guixiaoyang-chat-system\\skill-packages\\travel_route\\knowledge_docs\\business';

console.log('列出 business 目录下的所有文件:');
const files = fs.readdirSync(SOURCE_DIR);
files.forEach(file => {
  console.log(`  文件名: "${file}"`);
  console.log(`  字节: ${Buffer.from(file).toString('hex')}`);
  console.log('');
});