'use strict';

// Runs on the VPS from a mode-0600 temporary file. Never source .env as shell code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const project = '/www/wwwroot/afia-inventory';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function databaseConnection(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid production DATABASE_URL.'); }
  assert(['postgres:', 'postgresql:'].includes(url.protocol), 'DATABASE_URL must use PostgreSQL.');
  assert(decodeURIComponent(url.pathname.slice(1)) === 'afia_inventory_prod', 'DATABASE_URL must target afia_inventory_prod.');
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Production PostgreSQL must be on this VPS (localhost).');
  assert(url.username && !url.hash, 'DATABASE_URL requires a database user and no fragment.');
  const password = decodeURIComponent(url.password);
  const username = decodeURIComponent(url.username);
  assert(!/[\r\n]/.test(password + username), 'Unsupported newline in database credentials.');
  // Prisma parameters are not accepted by pg_dump/libpq. Reject ambiguous overrides.
  const prismaOnly = new Set(['schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'socket_timeout', 'statement_cache_size']);
  const libpq = new Set(['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslcrl', 'sslpassword', 'application_name', 'connect_timeout']);
  for (const [key] of [...url.searchParams]) {
    if (prismaOnly.has(key)) url.searchParams.delete(key);
    else assert(libpq.has(key), `Unsupported DATABASE_URL parameter: ${key}. Review before deployment.`);
  }
  // Keep ALL passwords out of argv, not just the database password.
  const sslpassword = url.searchParams.get('sslpassword');
  url.searchParams.delete('sslpassword');
  url.password = '';
  url.searchParams.set('connect_timeout', '10');
  const escape = value => value.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  const passfile = [url.hostname.replace(/^\[|\]$/g, ''), url.port || '5432', 'afia_inventory_prod', username, password].map(escape).join(':') + '\n';
  return { connection: url.toString(), passfile, sslpassword };
}

function assetReferences(html) {
  const references = new Set();
  for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const script = tag[1].toLowerCase() === 'script';
    if (!script && !/\brel\s*=\s*["']stylesheet["']/i.test(tag[0])) continue;
    const attr = new RegExp(`\\b${script ? 'src' : 'href'}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag[0]);
    if (!attr) continue;
    assert(/^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.(js|css)$/.test(attr[1]), 'Expected local hashed JS/CSS references in frontend HTML.');
    references.add(attr[1]);
  }
  const result = [...references].sort();
  assert(result.some(x => x.endsWith('.js')) && result.some(x => x.endsWith('.css')), 'Frontend HTML must contain hashed JavaScript and CSS.');
  return result;
}

function redact(text, env) {
  let clean = String(text || '').replace(/(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]*@[^\s"'<>]*/gi, '[REDACTED URL]');
  const values = Object.entries(env).filter(([key, value]) => /PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL/i.test(key) && value);
  for (const [, value] of values.sort((a, b) => b[1].length - a[1].length)) {
    clean = clean.split(value).join('[REDACTED]');
    clean = clean.split(encodeURIComponent(value)).join('[REDACTED]');
  }
  return clean;
}

function main() {
  const [mode, ...args] = process.argv.slice(2);
  const requireApi = createRequire(path.join(project, 'apps/api/package.json'));
  const { parse } = requireApi('dotenv');
  const root = parse(fs.readFileSync(path.join(project, '.env')));
  const apiEnvPath = path.join(project, 'apps/api/.env');
  const api = fs.existsSync(apiEnvPath) ? parse(fs.readFileSync(apiEnvPath)) : {};
  assert(root.DATABASE_URL, 'Missing DATABASE_URL in root production .env.');
  const db = databaseConnection(root.DATABASE_URL);
  if (api.DATABASE_URL) assert(api.DATABASE_URL === root.DATABASE_URL, 'API .env and root .env DATABASE_URL differ.');
  if (process.env.DATABASE_URL) assert(process.env.DATABASE_URL === root.DATABASE_URL, 'Shell DATABASE_URL differs from production .env.');
  const secrets = { ...process.env, ...root, ...api, DATABASE_PASSWORD: decodeURIComponent(new URL(root.DATABASE_URL).password) };
  const run = (command, argv, options = {}) => {
    const result = spawnSync(command, argv, {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: root.DATABASE_URL },
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options,
    });
    if (!options.quiet) {
      process.stdout.write(redact(result.stdout, secrets));
      process.stderr.write(redact(result.stderr, secrets));
    }
    assert(!result.error && result.status === 0, `${command} failed${result.status === null ? '' : ` (exit ${result.status})`}.`);
    return result.stdout;
  };
  const envFiles = () => {
    const snapshot = {};
    for (const directory of ['', 'apps/api', 'apps/web']) {
      for (const name of fs.readdirSync(path.join(project, directory))) {
        if (!/^\.env(?:\..+)?$/.test(name) || name.endsWith('.example')) continue;
        const relative = path.join(directory, name);
        assert(fs.statSync(path.join(project, relative)).isFile(), 'Production env path must be a file.');
        snapshot[relative] = crypto.createHash('sha256').update(fs.readFileSync(path.join(project, relative))).digest('hex');
      }
    }
    return snapshot;
  };

  switch (mode) {
    case 'preflight': {
      const processes = JSON.parse(run('pm2', ['jlist'], { quiet: true, cwd: project }));
      const matches = processes.filter(p => p.name === 'afia-api');
      assert(matches.length === 1, 'Expected exactly one existing PM2 afia-api process.');
      const pm = matches[0].pm2_env;
      const argv = Array.isArray(pm.args) ? pm.args : String(pm.args || '').split(/\s+/);
      assert(['npm', 'npm-cli.js'].includes(path.basename(pm.pm_exec_path || '')) &&
        /^run start (?:--workspace @afia\/api|--workspace=@afia\/api|-w @afia\/api)$/.test(argv.join(' ')),
      'Existing PM2 process must run npm run start --workspace @afia/api. Inspect PM2 manually.');
      assert(path.resolve(pm.pm_cwd || '') === project, 'PM2 afia-api must use the production project as its cwd.');
      if (pm.DATABASE_URL) assert(pm.DATABASE_URL === root.DATABASE_URL, 'PM2 DATABASE_URL differs from root production .env.');
      const effective = { ...root, ...api, ...pm };
      assert(path.resolve(project, 'apps/api', effective.INVOICE_IMPORT_STORAGE_ROOT || '.invoice-import-storage') ===
        '/var/lib/afia/invoice-import-storage', 'API must use the expected private invoice document storage.');
      break;
    }
    case 'tracked-safety': {
      const files = run('git', ['ls-tree', '-r', '--name-only', args[0]], { quiet: true }).trim().split('\n');
      assert(!files.some(file => /(^|\/)\.env(?:\..+)?$/.test(file) && !file.endsWith('.example')),
        'Incoming commit tracks a production .env file.');
      assert(!files.some(file => /^(apps\/web\/dist(?:-release)?\/|backups\/|\.invoice-import-storage\/)/.test(file)),
        'Incoming commit tracks production artifacts or storage.');
      break;
    }
    case 'env-snapshot': fs.writeFileSync(args[0], JSON.stringify(envFiles()), { mode: 0o600 }); break;
    case 'env-verify': {
      const previous = JSON.parse(fs.readFileSync(args[0], 'utf8'));
      assert(JSON.stringify(previous) === JSON.stringify(envFiles()), 'Production .env files changed; stop and inspect manually.');
      break;
    }
    case 'database-backup': {
      const passfile = path.join(args[1], 'pgpass');
      fs.writeFileSync(passfile, db.passfile, { mode: 0o600, flag: 'wx' });
      const env = { ...process.env, PGPASSFILE: passfile, PGCONNECT_TIMEOUT: '10' };
      // Do not allow inherited libpq settings to redirect or narrow this backup.
      for (const key of Object.keys(env)) if (key.startsWith('PG') && !['PGPASSFILE', 'PGCONNECT_TIMEOUT'].includes(key)) delete env[key];
      if (db.sslpassword) env.PGSSLPASSWORD = db.sslpassword;
      try {
        run('pg_dump', ['--dbname', db.connection, '--format=custom', '--no-password', '--file', args[0]], { env });
      } finally { fs.rmSync(passfile, { force: true }); }
      break;
    }
    case 'run': run(args[0], args.slice(1)); break;
    case 'assets': process.stdout.write(assetReferences(fs.readFileSync(args[0], 'utf8')).join('\n') + '\n'); break;
    case 'health': {
      const response = JSON.parse(fs.readFileSync(args[0], 'utf8'));
      assert(response.status === 'ok' && response.service === 'afia-inventory-api', 'Unexpected API health response.');
      break;
    }
    case 'diagnostics': {
      // No raw PM2 environment dump; bounded logs are sanitized before display.
      for (const argv of [['status'], ['logs', 'afia-api', '--lines', '50', '--nostream']]) {
        try { run('pm2', argv, { timeout: 10000 }); } catch { process.stderr.write('PM2 diagnostic command failed.\n'); }
      }
      break;
    }
    default: throw new Error('Unknown deployment support operation.');
  }
}

module.exports = { databaseConnection, assetReferences, redact };
if (require.main === module) {
  try { main(); } catch (error) {
    // Never print a stack/config dump that could include connection credentials.
    const message = error instanceof SyntaxError || error instanceof URIError ? 'Invalid deployment configuration or response.' : error.message;
    console.error(`Deployment check failed: ${message}`);
    process.exitCode = 1;
  }
}
