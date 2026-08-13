/**
 * FlyAI key probe — key via env FLYAI_API_KEY only; never printed.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/test-output/flyai-probe');
fs.mkdirSync(OUT, { recursive: true });

const key = process.env.FLYAI_API_KEY || '';
console.log('key_set', Boolean(key), 'key_len', key.length, 'key_prefix', key.slice(0, 5) + '...');

function run(args, outName, timeoutMs = 120000) {
  console.log('\n===', args.join(' '), '===');
  const started = Date.now();
  const r = spawnSync('flyai', args, {
    encoding: 'utf8',
    env: { ...process.env, FLYAI_API_KEY: key },
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
    shell: true,
  });
  const elapsed = Date.now() - started;
  const stdout = (r.stdout || '').trim();
  const stderr = (r.stderr || '').trim();
  fs.writeFileSync(path.join(OUT, outName + '.stdout.txt'), stdout, 'utf8');
  fs.writeFileSync(path.join(OUT, outName + '.stderr.txt'), stderr, 'utf8');
  console.log('status', r.status, 'signal', r.signal, 'elapsed_ms', elapsed);
  console.log('stdout_bytes', Buffer.byteLength(stdout, 'utf8'), 'stderr_bytes', Buffer.byteLength(stderr, 'utf8'));
  if (stderr) console.log('stderr_head:', stderr.slice(0, 400).replace(key, '***'));
  let parsed = null;
  try {
    const cut = stdout.search(/\nAssertion failed/);
    const t = (cut >= 0 ? stdout.slice(0, cut) : stdout).trim();
    if (t.startsWith('{')) {
      parsed = JSON.parse(t);
      fs.writeFileSync(path.join(OUT, outName + '.pretty.json'), JSON.stringify(parsed, null, 2), 'utf8');
      console.log('PARSE_OK topKeys', Object.keys(parsed));
      const data = parsed.data || {};
      const list = data.itemList || data.items || data.list || [];
      console.log('itemList', Array.isArray(list) ? list.length : 'n/a');
      if (Array.isArray(list)) {
        list.slice(0, 8).forEach((it, i) => {
          const info = it.info || it;
          console.log(
            String(i + 1).padStart(2, '0'),
            '|',
            info.title || info.name || '(no title)',
            '| price=',
            info.price ?? info.ticketInfo?.price ?? null,
            '| lat=',
            info.latitude ?? null,
          );
        });
      }
      console.log('sample:\n' + JSON.stringify(parsed, null, 2).slice(0, 1200));
    } else {
      console.log('NOT_JSON:', stdout.slice(0, 500) || '(empty)');
    }
  } catch (e) {
    console.log('PARSE_FAIL', e.message);
    console.log('stdout_head', stdout.slice(0, 500));
  }
  return { status: r.status, parsed };
}

// persist key for CLI config (optional enhanced path)
{
  const cfg = spawnSync('flyai', ['config', 'set', 'FLYAI_API_KEY', key], {
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, FLYAI_API_KEY: key },
  });
  console.log('config set status', cfg.status, (cfg.stderr || cfg.stdout || '').slice(0, 200).replace(key, '***'));
}

run(['keyword-search', '--query', '我想去巴马旅游'], 'withkey-keyword-bama');
run(['ai-search', '--query', '我想去巴马旅游'], 'withkey-ai-bama', 150000);
run(['search-poi', '--keyword', '巴马', '--city-name', '河池'], 'withkey-poi-bama');

console.log('\n=== done ===');
console.log('out', OUT);
