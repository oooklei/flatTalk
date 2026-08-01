import fs from 'fs';
const dirs = ['src/skills/find_service/templates/html', 'src/skills/dispatch_manage/templates/html'];
let bad = 0, count = 0;
for (const d of dirs) {
  for (const f of fs.readdirSync(d)) {
    if (f.endsWith('.manifest.json')) {
      count++;
      try {
        const j = JSON.parse(fs.readFileSync(d + '/' + f, 'utf8'));
        if (!Array.isArray(j.followup_actions)) { console.log('NO followup_actions: ' + f); bad++; }
      } catch (e) { console.log('BAD JSON: ' + f); bad++; }
    }
  }
}
console.log(`checked=${count} issues=${bad} -> ${bad === 0 ? 'ALL_OK' : 'HAS_ISSUES'}`);
