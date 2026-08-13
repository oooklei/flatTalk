import { execSync } from 'child_process';
try {
  const r = execSync('curl -s http://127.0.0.1:5298/api/admin/templates').toString();
  const j = JSON.parse(r);
  const routes = j.items.filter(i => i.skill === 'travel_route');
  console.log('travel_route 模板数:', routes.length);
  routes.forEach(i => console.log('  -', i.id, '| fields:', i.fields, '|', (i.description || '').slice(0, 40)));
} catch (e) {
  console.error('ERROR:', e.message);
}
