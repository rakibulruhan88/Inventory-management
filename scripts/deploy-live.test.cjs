'use strict';

// All commands/VPS paths are sandboxed in temporary directories. No SSH or push.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { databaseConnection, assetReferences, redact } = require('./deploy-live-support.cjs');
const root = path.resolve(__dirname, '..');

test('backup URL removes Prisma parameters and passwords; passfile escapes credentials', () => {
  const db = databaseConnection('postgresql://afia:pa%3Ass%5Cword@localhost:5432/afia_inventory_prod?schema=public&connection_limit=5&pool_timeout=10&sslmode=require');
  assert(!db.connection.includes('pa%3Ass'));
  assert(!db.connection.includes('schema') && !db.connection.includes('connection_limit') && !db.connection.includes('pool_timeout'));
  assert(db.connection.includes('sslmode=require'));
  assert.equal(db.passfile, 'localhost:5432:afia_inventory_prod:afia:pa\\:ss\\\\word\n');
});
test('backup refuses the wrong database, remote host and libpq database override', () => {
  for (const url of ['postgresql://afia:pw@localhost/local_dev', 'postgresql://afia:pw@other/afia_inventory_prod',
    'postgresql://afia:pw@localhost/afia_inventory_prod?dbname=wrong', 'postgresql://afia:pw@localhost/afia_inventory_prod?password=bad']) {
    assert.throws(() => databaseConnection(url));
  }
});
test('asset check requires hashed local JS and CSS and rejects traversal or missing styles', () => {
  assert.deepEqual(assetReferences('<script type="module" src="/assets/index-ABC123.js"></script><link href="/assets/index-DEF456.css" rel="stylesheet">'),
    ['/assets/index-ABC123.js', '/assets/index-DEF456.css']);
  assert.throws(() => assetReferences('<script src="/assets/../../private-secret.js"></script>'));
  assert.throws(() => assetReferences('<script src="/assets/index-ABC123.js"></script>'));
});
test('logs redact connection URLs and known raw/encoded secrets', () => {
  const clean = redact('postgresql://afia:pa%3Ass@localhost/db pa:ss pa%3Ass jwt-secret', { DATABASE_PASSWORD: 'pa:ss', JWT_SECRET: 'jwt-secret' });
  assert(!clean.includes('pa:ss') && !clean.includes('pa%3Ass') && !clean.includes('jwt-secret'));
});

const mock = String.raw`
const fs = require('node:fs'), path = require('node:path');
const command = path.basename(process.argv[1]), a = process.argv.slice(2);
const p = process.env.TEST_PROJECT, state = process.env.TEST_STATE, scenario = process.env.TEST_SCENARIO;
const sha = 'a'.repeat(40), old = 'b'.repeat(40);
fs.appendFileSync(path.join(state, 'commands'), command + ' ' + a.join(' ') + '\n');
const exit = n => process.exit(n);
const write = (file, value) => { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file,value); };
if(command === 'git') {
  if(a[0] === 'branch') console.log('invoice-import');
  else if(a[0] === 'status') { if(scenario === 'dirty') console.log(' M private-file'); }
  else if(a[0] === 'rev-parse') console.log(a[1] === '--show-toplevel' ? p : a[1] === 'origin/invoice-import' ? (scenario === 'advanced' ? old : sha) : fs.readFileSync(path.join(state,'head'),'utf8'));
  else if(a[0] === 'pull') write(path.join(state,'head'),sha);
  else if(a[0] === 'ls-tree') console.log(scenario === 'tracked-env' ? '.env' : 'package.json');
  else if(a[0] === 'push' && scenario === 'push') exit(1);
  else if(a[0] === 'ls-remote') console.log(sha + '\trefs/heads/invoice-import');
} else if(command === 'npm') {
  if(scenario === 'dependencies' && a[0] === 'ci') exit(1);
  if(scenario === 'migration' && a.includes('deploy')) exit(1);
  if(scenario === 'status' && a.includes('status')) exit(1);
  if(a.includes('status')) console.log('Database schema is up to date!');
} else if(command === 'npx') {
  if(scenario === 'build') exit(1);
  if(a.includes('vite')) {
    write(path.join(p,'apps/web/dist-release/index.html'),'<script type="module" src="/assets/index-ABC123.js"></script><link rel="stylesheet" href="/assets/index-DEF456.css">');
    write(path.join(p,'apps/web/dist-release/assets/index-ABC123.js'),'new-js');
    write(path.join(p,'apps/web/dist-release/assets/index-DEF456.css'),'new-css');
    write(path.join(p,'apps/web/dist-release/.user.ini'),'must-not-publish');
  }
} else if(command === 'pm2') {
  if(a[0] === 'jlist') console.log(JSON.stringify([{name:'afia-api',pm2_env:{
    pm_exec_path:'/usr/bin/npm',pm_cwd:p,args:['run',scenario === 'runtime' ? 'start:prod' : 'start','--workspace','@afia/api'],
    INVOICE_IMPORT_STORAGE_ROOT:process.env.TEST_STORAGE
  }}]));
  if(a[0] === 'restart' && scenario === 'restart') exit(1);
  if(a[0] === 'status') console.log('afia-api errored');
  if(a[0] === 'logs') console.log('Database error postgresql://afia:secret-pass@localhost/db secret-pass jwt-secret-value');
} else if(command === 'pg_dump') {
  if(a.join(' ').includes('secret-pass') || process.env.PGPASSWORD) exit(9);
  if(!fs.statSync(process.env.PGPASSFILE).isFile() || (fs.statSync(process.env.PGPASSFILE).mode & 0o777) !== 0o600) exit(9);
  if(scenario === 'backup') exit(1);
  write(a[a.indexOf('--file')+1],'custom-dump-fixture');
} else if(command === 'rsync') {
  if(scenario === 'publish') exit(1);
  const src = a[a.length-2], dest = a[a.length-1];
  if(src.endsWith('index.html')) fs.copyFileSync(src,path.join(dest,'index.html'));
  else {
    for(const exclusion of ['/.well-known/','/.user.ini','/404.html','/502.html','/index.html']) if(!a.includes('--exclude='+exclusion)) exit(9);
    for(const entry of fs.readdirSync(dest)) if(!['.well-known','.user.ini','404.html','502.html','index.html'].includes(entry)) fs.rmSync(path.join(dest,entry),{recursive:true,force:true});
    for(const entry of fs.readdirSync(src)) if(!['.well-known','.user.ini','404.html','502.html','index.html'].includes(entry)) fs.cpSync(path.join(src,entry),path.join(dest,entry),{recursive:true});
  }
} else if(command === 'curl') {
  const output = a[a.indexOf('-o')+1], url = a.find(x => /^https?:/.test(x));
  if(url.includes('/api/health')) {
    if(scenario === 'health') exit(22);
    const counter = path.join(state,'health-count'), count = fs.existsSync(counter) ? +fs.readFileSync(counter,'utf8') : 0;
    write(counter,String(count+1));
    if(scenario === 'retry' && count === 0) exit(22);
    write(output,JSON.stringify({status:'ok',service:'afia-inventory-api'}));
  } else if(url.endsWith('/')) {
    write(output,scenario === 'stale' ? '<script src="/assets/index-OLD.js"></script><link rel="stylesheet" href="/assets/index-OLD.css">' : fs.readFileSync(path.join(p,'apps/web/dist/index.html')));
    process.stdout.write(scenario === 'redirect' ? '302' : '200');
  } else {
    const asset = new URL(url).pathname;
    write(output,scenario === 'asset' ? 'stale-content' : fs.readFileSync(path.join(p,'apps/web/dist-release',asset)));
    process.stdout.write('200');
  }
} else if(command === 'ssh') { throw new Error('Tests must never SSH.'); }
`;

function fixture(scenario, local = false) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'afia-deploy-test-'));
  const p = path.join(temp, 'project'), state = path.join(temp, 'state'), bin = path.join(temp, 'bin');
  const storage = path.join(temp, 'private/invoice-import-storage'), backups = path.join(temp,'backups');
  for (const d of [bin,state,storage,path.join(p,'apps/api'),path.join(p,'apps/web/dist/.well-known'),path.join(p,'scripts'),path.join(p,'node_modules')]) fs.mkdirSync(d,{recursive:true});
  for(const command of ['git','npm','npx','pm2','pg_dump','pg_restore','rsync','curl','flock','ssh']) {
    fs.writeFileSync(path.join(bin,command), '#!' + process.execPath + '\n' + mock, {mode:0o755});
  }
  const initialEnv = 'DATABASE_URL="postgresql://afia:secret-pass@localhost:5432/afia_inventory_prod?schema=public"\nJWT_SECRET=jwt-secret-value\n';
  fs.writeFileSync(path.join(p,'.env'),initialEnv);
  fs.writeFileSync(path.join(p,'apps/api/package.json'),'{}');
  fs.writeFileSync(path.join(p,'package-lock.json'),'{}');
  fs.symlinkSync(path.dirname(require.resolve('dotenv/package.json',{paths:[path.join(root,'apps/api')]})),path.join(p,'node_modules/dotenv'));
  fs.writeFileSync(path.join(state,'head'), local ? 'a'.repeat(40) : 'b'.repeat(40));
  fs.writeFileSync(path.join(storage,'private.pdf'),'keep-document');
  for (const name of ['index.html','.user.ini','404.html','502.html','.well-known/challenge']) fs.writeFileSync(path.join(p,'apps/web/dist',name),'keep-'+name);
  const supportFile = path.join(temp,'support.cjs');
  fs.writeFileSync(supportFile,fs.readFileSync(path.join(__dirname,'deploy-live-support.cjs'),'utf8')
    .replaceAll('/www/wwwroot/afia-inventory',p).replaceAll('/var/lib/afia/invoice-import-storage',storage));
  let remote = fs.readFileSync(path.join(__dirname,'deploy-live-remote.sh'),'utf8')
    .replaceAll('/www/wwwroot/afia-inventory',p).replaceAll('/home/ubuntu/backups/afia',backups).replaceAll('/var/lib/afia',path.dirname(storage));
  if(scenario === 'health') remote = remote.replace('SECONDS + 45','SECONDS + 1');
  fs.writeFileSync(path.join(p,'scripts/deploy-live-support.cjs'),fs.readFileSync(path.join(__dirname,'deploy-live-support.cjs')));
  fs.writeFileSync(path.join(p,'scripts/deploy-live-remote.sh'),remote);
  const runner = path.join(p,'deploy-live.sh');
  fs.writeFileSync(runner,local ? fs.readFileSync(path.join(root,'deploy-live.sh')) : remote);
  const env = {...process.env,PATH:bin+path.delimiter+process.env.PATH,support_file:supportFile,
    TEST_PROJECT:p,TEST_STATE:state,TEST_STORAGE:storage,TEST_SCENARIO:scenario};
  delete env.DATABASE_URL;
  env.PGPASSWORD = 'inherited-wrong-password';
  const result = spawnSync('bash',[runner,'a'.repeat(40)],{env,encoding:'utf8',timeout:30000});
  const commands = fs.readFileSync(path.join(state,'commands'),'utf8');
  return {temp,p,state,backups,storage,initialEnv,result,commands, output:result.stdout+result.stderr};
}

test('sandboxed deployment succeeds, retries readiness, preserves env/documents/aaPanel files', () => {
  const f = fixture('retry');
  try {
    assert.equal(f.result.status,0,f.output);
    assert(f.output.includes('DEPLOY SUCCESS'));
    assert.equal(fs.readFileSync(path.join(f.p,'.env'),'utf8'),f.initialEnv);
    assert.equal(fs.readFileSync(path.join(f.storage,'private.pdf'),'utf8'),'keep-document');
    for(const name of ['.user.ini','404.html','502.html','.well-known/challenge']) assert.equal(fs.readFileSync(path.join(f.p,'apps/web/dist',name),'utf8'),'keep-'+name);
    assert(f.commands.includes('npm ci --include=dev'));
    assert(f.commands.includes('prisma migrate deploy') && f.commands.includes('prisma migrate status'));
    assert(f.commands.includes('pm2 restart afia-api --update-env') && f.commands.includes('pm2 save'));
    assert(fs.readdirSync(path.join(f.backups,'database')).some(x=>x.endsWith('.dump')));
    assert(fs.readdirSync(path.join(f.backups,'documents')).some(x=>x.endsWith('.tar.gz')));
    assert(!f.output.includes('secret-pass') && !f.output.includes('jwt-secret-value'));
  } finally { fs.rmSync(f.temp,{recursive:true,force:true}); }
});

for(const scenario of ['runtime','backup','advanced','tracked-env','dependencies','migration','status','build','publish','restart','health','stale','redirect','asset']) {
  test(`sandboxed ${scenario} failure stops at the correct boundary`, () => {
    const f = fixture(scenario);
    try {
      assert.notEqual(f.result.status,0,f.output);
      assert(f.output.includes('DEPLOY FAILED:') && !f.output.includes('DEPLOY SUCCESS'));
      const failedStep = { runtime:3, backup:3, advanced:4, 'tracked-env':4, dependencies:5,
        migration:6, status:6, build:7, publish:8, restart:9, health:10, stale:10, redirect:10, asset:10 }[scenario];
      assert(f.output.includes(`DEPLOY FAILED: [${failedStep}/10]`),f.output);
      assert(!f.output.includes('secret-pass') && !f.output.includes('jwt-secret-value'));
      assert.equal(fs.readFileSync(path.join(f.p,'.env'),'utf8'),f.initialEnv);
      assert.equal(fs.readFileSync(path.join(f.storage,'private.pdf'),'utf8'),'keep-document');
      if(['runtime','backup'].includes(scenario)) assert(!f.commands.includes('git pull'));
      if(['advanced','tracked-env','dependencies','migration','status','build'].includes(scenario)) {
        assert(!f.commands.includes('rsync '));
        assert(!f.commands.includes('pm2 restart'));
        assert.equal(fs.readFileSync(path.join(f.p,'apps/web/dist/index.html'),'utf8'),'keep-index.html');
      }
      if(['restart','health','stale','redirect','asset'].includes(scenario)) {
        assert(f.commands.includes('pm2 status') && f.commands.includes('pm2 logs afia-api --lines 50 --nostream'));
      }
    } finally { fs.rmSync(f.temp,{recursive:true,force:true}); }
  });
}
for(const scenario of ['dirty','push']) {
  test(`local ${scenario} failure never contacts the VPS`, () => {
    const f = fixture(scenario,true);
    try { assert.notEqual(f.result.status,0); assert(!f.commands.includes('ssh ')); }
    finally { fs.rmSync(f.temp,{recursive:true,force:true}); }
  });
}
