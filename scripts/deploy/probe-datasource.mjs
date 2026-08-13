// 探测数据源：本机/远程 PG 表结构与数据量、local-kb SQLite 内容
import pg from 'pg';
import fs from 'node:fs';

const lines = [];
const say = (s = '') => { lines.push(String(s)); };

async function probePg(label, url) {
  say(`=== ${label} ===`);
  say(`url: ${url.replace(/:[^:@]+@/, ':***@')}`);
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const t = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' ORDER BY table_name`,
    );
    say(`表数: ${t.rows.length}`);
    for (const r of t.rows) {
      let cnt = '?';
      try {
        const c = await client.query(`SELECT count(*)::int AS n FROM "${r.table_name}"`);
        cnt = c.rows[0].n;
      } catch (e) { cnt = 'ERR'; }
      say(`  ${r.table_name.padEnd(38)} ${cnt}`);
    }
  } catch (e) {
    say(`CONNECT_FAIL: ${e.message}`);
  } finally {
    try { await client.end(); } catch {}
  }
  say('');
}

const targets = [
  ['本机/160 tag_system', process.env.PROBE_LOCAL_PG
    || 'postgresql://tag_system:ab42be71d048cd4c1e387fd154d88ecd1985017466b4a942@192.168.1.160:5432/tag_system'],
  ['localhost tag_system', 'postgresql://postgres:123456@localhost:5432/tag_system'],
];

for (const [label, url] of targets) {
  await probePg(label, url);
}

// local-kb SQLite（已弃用，改用远程 gxy-local-kb）
say('=== local-kb SQLite（已弃用）===');
say('本地 SQLite 知识库已停用，知识库走远程 gxy-local-kb 服务');
say('');

// flatTalk 本地数据文件
say('=== flatTalk data/ 关键文件 ===');
for (const f of ['data/knowledge.json', 'data/config.json', 'data/model-registry.json',
  'data/integrations.json', 'data/flyai-kb/seeds.json', 'data/trace_route.json']) {
  if (fs.existsSync(f)) {
    const st = fs.statSync(f);
    let hint = '';
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      hint = Array.isArray(j) ? `array(${j.length})` : `keys(${Object.keys(j).length})`;
    } catch { hint = 'non-json'; }
    say(`  ${f.padEnd(34)} ${(st.size / 1024).toFixed(1)}KB  ${hint}`);
  } else {
    say(`  ${f.padEnd(34)} MISSING`);
  }
}

fs.writeFileSync('build/probe-datasource.txt', lines.join('\n'), 'utf8');
console.log('written build/probe-datasource.txt');
