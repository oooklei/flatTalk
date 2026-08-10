// 验证所有模板的 JSON 合法性 + discover 加载
import { discoverTemplates } from '../src/template-card/discover.js';

const skillDirs = [
  ['common', 'src/skills/common/templates/html'],
  ['dispatch_manage', 'src/skills/dispatch_manage/templates/html'],
  ['find_service', 'src/skills/find_service/templates/html'],
  ['health_risk_warning', 'src/skills/health_risk_warning/templates/html'],
  ['meal_plan', 'src/skills/meal_plan/templates/html'],
  ['nearby_resource', 'src/skills/nearby_resource/templates/html'],
  ['travel_route', 'src/skills/travel_route/templates/html'],
];

let totalLoaded = 0, totalDesc = 0, totalMissing = [];
for (const [name, dir] of skillDirs) {
  try {
    const templates = discoverTemplates(new URL(`../${dir}/`, import.meta.url).pathname.slice(1));
    const withDesc = templates.filter(t => t.description);
    const withoutDesc = templates.filter(t => !t.description);
    console.log(`✅ ${name}: ${templates.length} 模板 | ${withDesc.length} 有描述 | ${withoutDesc.length} 缺描述`);
    totalLoaded += templates.length;
    totalDesc += withDesc.length;
    if (withoutDesc.length) totalMissing.push(`${name}: ${withoutDesc.map(t=>t.id).join(', ')}`);
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
  }
}

console.log(`\n总计: ${totalLoaded} 模板 | ${totalDesc} 有描述 | ${totalLoaded - totalDesc} 缺描述`);
if (totalMissing.length) {
  console.log('\n仍缺 description:');
  totalMissing.forEach(m => console.log('  ' + m));
} else {
  console.log('\n🎉 全部模板均有 description!');
}
