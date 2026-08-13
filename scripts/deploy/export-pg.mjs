// 从本机 localhost:5432/tag_system 导出全量表结构与数据为 SQL 文件。
// 不依赖 pg_dump（本机未安装），用 information_schema 重建 DDL + COPY 数据。
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.env.SRC_PG || 'postgresql://postgres:123456@localhost:5432/tag_system';
const OUT_DIR = 'build/pgdump';
fs.mkdirSync(OUT_DIR, { recursive: true });

const client = new pg.Client({ connectionString: SRC, connectionTimeoutMillis: 10000 });
await client.connect();

const { rows: tables } = await client.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE'
   ORDER BY table_name`,
);

const log = [];
const ddl = ['-- 表结构（由 export-pg.mjs 生成）', 'SET client_encoding = UTF8;', ''];

function quoteIdent(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

function literal(v, dataType) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'`;
  if (typeof v === 'object') {
    // json/jsonb/array
    return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

for (const { table_name: t } of tables) {
  // 列定义
  const { rows: cols } = await client.query(
    `SELECT column_name, data_type, udt_name, character_maximum_length,
            numeric_precision, numeric_scale, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [t],
  );

  const colDefs = cols.map((c) => {
    let type = c.data_type;
    if (type === 'character varying') type = c.character_maximum_length ? `varchar(${c.character_maximum_length})` : 'varchar';
    else if (type === 'character') type = `char(${c.character_maximum_length || 1})`;
    else if (type === 'numeric' && c.numeric_precision) type = `numeric(${c.numeric_precision},${c.numeric_scale || 0})`;
    else if (type === 'ARRAY') type = `${c.udt_name.replace(/^_/, '')}[]`;
    else if (type === 'USER-DEFINED') type = c.udt_name;
    else if (type === 'timestamp without time zone') type = 'timestamp';
    else if (type === 'timestamp with time zone') type = 'timestamptz';

    // serial 列：DEFAULT nextval('x_id_seq') 依赖序列先存在。
    // 直接用 serial/bigserial，让 PG 自己建序列，避免顺序依赖。
    const isSerial = c.column_default && /^nextval\(/i.test(c.column_default);
    if (isSerial) {
      const serialType = type === 'bigint' ? 'bigserial'
        : type === 'smallint' ? 'smallserial' : 'serial';
      let def = `  ${quoteIdent(c.column_name)} ${serialType}`;
      if (c.is_nullable === 'NO') def += ' NOT NULL';
      return def;
    }

    let def = `  ${quoteIdent(c.column_name)} ${type}`;
    if (c.column_default) def += ` DEFAULT ${c.column_default}`;
    if (c.is_nullable === 'NO') def += ' NOT NULL';
    return def;
  });

  ddl.push(`DROP TABLE IF EXISTS ${quoteIdent(t)} CASCADE;`);
  ddl.push(`CREATE TABLE ${quoteIdent(t)} (`);
  ddl.push(colDefs.join(',\n'));
  ddl.push(');');
  ddl.push('');

  // 主键
  const { rows: pk } = await client.query(
    `SELECT a.attname
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary`,
    [`public.${t}`],
  );
  if (pk.length) {
    ddl.push(
      `ALTER TABLE ${quoteIdent(t)} ADD PRIMARY KEY (${pk.map((r) => quoteIdent(r.attname)).join(', ')});`,
    );
    ddl.push('');
  }

  // 数据
  const { rows: data } = await client.query(`SELECT * FROM ${quoteIdent(t)}`);
  log.push(`${t.padEnd(38)} cols=${String(cols.length).padStart(3)} rows=${data.length}`);

  if (data.length) {
    const dataFile = path.join(OUT_DIR, `data_${t}.sql`);
    const stream = fs.createWriteStream(dataFile, { encoding: 'utf8' });
    stream.write('SET client_encoding = UTF8;\n');
    const colNames = cols.map((c) => quoteIdent(c.column_name)).join(', ');
    // 分批 INSERT，每批 200 行
    for (let i = 0; i < data.length; i += 200) {
      const batch = data.slice(i, i + 200);
      const values = batch
        .map((row) => '(' + cols.map((c) => literal(row[c.column_name], c.data_type)).join(', ') + ')')
        .join(',\n');
      stream.write(`INSERT INTO ${quoteIdent(t)} (${colNames}) VALUES\n${values};\n`);
    }
    stream.end();
  }
}

// 序列重置
const { rows: seqs } = await client.query(
  `SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public'`,
);
const seqSql = ['-- 序列重置（容错：序列不存在时跳过）'];
for (const { sequence_name: s } of seqs) {
  const { rows } = await client.query(`SELECT last_value FROM ${quoteIdent(s)}`);
  seqSql.push(
    `DO $$ BEGIN PERFORM setval('${s}', ${rows[0].last_value}); `
    + `EXCEPTION WHEN undefined_table THEN RAISE NOTICE 'skip ${s}'; END $$;`,
  );
}
fs.writeFileSync(path.join(OUT_DIR, '99_sequences.sql'), seqSql.join('\n'), 'utf8');

fs.writeFileSync(path.join(OUT_DIR, '00_schema.sql'), ddl.join('\n'), 'utf8');
fs.writeFileSync('build/export-pg-report.txt', log.join('\n'), 'utf8');

await client.end();

const files = fs.readdirSync(OUT_DIR);
const totalMB = files.reduce((a, f) => a + fs.statSync(path.join(OUT_DIR, f)).size, 0) / 1024 / 1024;
console.log(`导出 ${tables.length} 表, ${files.length} 文件, ${totalMB.toFixed(2)} MB -> ${OUT_DIR}`);
console.log(log.join('\n'));
