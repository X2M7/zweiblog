const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  rmSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');

// Source definitions only: never run the root pre-check, menu or real Docker.
const definitions = readFileSync(join(__dirname, 'zweiblog.sh'), 'utf8').split('\npre_check\n')[0];
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'zweiblog-ops-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'site', 'data'), { recursive: true });
  writeFileSync(join(root, 'site', 'data', 'content'), 'database fixture');
  writeFileSync(join(root, 'site', 'docker-compose.yaml'), 'services: {}\n');
  writeFileSync(join(root, 'functions.sh'), definitions);
  const run = (script, vars = {}) =>
    spawnSync(
      'bash',
      ['-c', `source "$CASE_ROOT/functions.sh"\nZWEIBLOG_BASE_PATH="$CASE_ROOT/site"\n${script}`],
      {
        cwd: root,
        env: { ...process.env, CASE_ROOT: root, ...vars },
        encoding: 'utf8',
        timeout: 15000,
      },
    );
  return { root, run };
}

const downloadMocks = `
stat() { case "$2" in %u) echo 0;; %a) echo 700;; *) command stat "$@";; esac; }
curl() {
  local output="\${!#}"
  printf '%s' "$output" > "$CASE_ROOT/download-location"
  cp "$CASE_ROOT/candidate.sh" "$output"
  return "\${CURL_FAILURE:-0}"
}
`;
for (const failure of ['download', 'syntax', 'empty-version']) {
  test(`self-update stops on ${failure} and cleans the private download`, (t) => {
    const { root, run } = fixture(t);
    const candidate =
      failure === 'syntax'
        ? 'if (\n'
        : failure === 'empty-version'
          ? '#!/bin/bash\ntrue\n'
          : 'ZWEIBLOG_SCRIPT_VERSION="v1"\ntouch "$CASE_ROOT/executed"\n';
    writeFileSync(join(root, 'candidate.sh'), candidate);
    const result = run(`${downloadMocks}\nupdate_script`, {
      CURL_FAILURE: failure === 'download' ? '22' : '0',
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(root, 'executed')), false);
    assert.equal(existsSync(join(root, 'site', 'zweiblog.sh')), false);
    assert.equal(existsSync(readFileSync(join(root, 'download-location'), 'utf8')), false);
  });
}
test('self-update installs and runs only the validated private artifact', (t) => {
  const { root, run } = fixture(t);
  const candidate = 'ZWEIBLOG_SCRIPT_VERSION="v1"\nprintf done > "$CASE_ROOT/executed"\n';
  writeFileSync(join(root, 'candidate.sh'), candidate);
  writeFileSync(join(root, 'zweiblog.sh'), 'untrusted caller directory');
  const result = run(`${downloadMocks}\nupdate_script`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(root, 'site', 'zweiblog.sh'), 'utf8'), candidate);
  assert.equal(statSync(join(root, 'site', 'zweiblog.sh')).mode & 0o777, 0o700);
  assert.equal(readFileSync(join(root, 'executed'), 'utf8'), 'done');
  assert.equal(readFileSync(join(root, 'zweiblog.sh'), 'utf8'), 'untrusted caller directory');
  assert.equal(existsSync(readFileSync(join(root, 'download-location'), 'utf8')), false);
});

const backupMocks = `
printf running > "$CASE_ROOT/state"
zweiblog_compose() {
  printf '%s\\n' "$*" >> "$CASE_ROOT/commands"
  case "$*" in
    'ps --services --filter status=running')
      [[ "\${QUERY_FAILURE:-0}" == 0 ]] || return 1
      if [[ "$(cat "$CASE_ROOT/state")" == running ]]; then printf 'zweiblog\\nmongo\\n'; fi;;
    'ps -a -q mongo') echo mongo-container;;
    'ps -q zweiblog') echo app-container;;
    stop*) printf stopped > "$CASE_ROOT/state"; return "\${STOP_FAILURE:-0}";;
    start*) [[ "\${START_FAILURE:-0}" == 0 ]] || return 1; printf running > "$CASE_ROOT/state";;
    *) return 1;;
  esac
}
docker() {
  case "$*" in
    'inspect --format {{.Image}} app-container') printf 'sha256:%064d\\n' 1;;
    *) printf 'exited %s\\n' "\${MONGO_EXIT:-0}";;
  esac
}
`;
test('backup stops writers and clean Mongo, archives data/config, then resumes previous services', (t) => {
  const { root, run } = fixture(t);
  const result = run(`${backupMocks}\nbackup 0`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /备份成功/);
  const archives = readdirSync(join(root, 'site')).filter((name) => name.endsWith('.tar.gz'));
  assert.equal(archives.length, 1);
  assert.equal(statSync(join(root, 'site', archives[0])).mode & 0o777, 0o600);
  const contents = spawnSync('tar', ['tzf', join(root, 'site', archives[0])], { encoding: 'utf8' });
  assert.match(contents.stdout, /data\/content/);
  assert.match(contents.stdout, /docker-compose.yaml/);
  const pin = spawnSync('tar', ['xOf', join(root, 'site', archives[0]), '.zweiblog-image.yaml'], {
    encoding: 'utf8',
  });
  assert.match(pin.stdout, /image: sha256:0{63}1/);
  assert.equal(readFileSync(join(root, 'state'), 'utf8'), 'running');
  assert.match(
    readFileSync(join(root, 'commands'), 'utf8'),
    /stop --timeout 120 zweiblog mongo[\s\S]*start zweiblog mongo/,
  );
});
for (const [name, vars, extra] of [
  ['partial stop', { STOP_FAILURE: '1' }, ''],
  ['unclean Mongo', { MONGO_EXIT: '137' }, ''],
  ['archive failure', {}, 'tar() { return 1; }'],
  ['service restart failure', { START_FAILURE: '1' }, ''],
  ['Docker query failure', { QUERY_FAILURE: '1' }, ''],
]) {
  test(`backup reports ${name} without false success and attempts recovery`, (t) => {
    const { root, run } = fixture(t);
    const result = run(`${backupMocks}\n${extra}\nbackup 0`, vars);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /备份成功/);
    const commands = readFileSync(join(root, 'commands'), 'utf8');
    if (name !== 'Docker query failure') assert.match(commands, /start zweiblog mongo/);
    if (name !== 'service restart failure')
      assert.equal(readFileSync(join(root, 'state'), 'utf8'), 'running');
    assert.equal(
      readdirSync(join(root, 'site')).some((name) => name.startsWith('.zweiblog-backup.')),
      false,
    );
  });
}

const oldImage = `sha256:${'a'.repeat(64)}`;
const newImage = `sha256:${'b'.repeat(64)}`;
const updateMocks = `
backup() { echo backup >> "$CASE_ROOT/commands"; }
zweiblog_compose() {
  echo "$*" >> "$CASE_ROOT/commands"
  case "$*" in
    'ps -q zweiblog') echo blog-container;;
    config) printf 'services:\\n  zweiblog:\\n    image: example/blog:latest\\n';;
    'pull zweiblog') return "\${PULL_FAILURE:-0}";;
    'up -d --no-deps zweiblog') return 0;;
    *) return 1;;
  esac
}
docker() {
  echo "docker $*" >> "$CASE_ROOT/commands"
  case "$*" in
    'inspect --format {{.Image}} blog-container') echo '${oldImage}';;
    'image inspect --format {{.Id}} example/blog:latest') echo '${newImage}';;
    tag*|'image inspect ${oldImage}') return 0;;
    *) return 1;;
  esac
}
wait_for_zweiblog() {
  if [[ "\${UNHEALTHY_UPDATE:-0}" == 1 && ! -f "$CASE_ROOT/tried" ]]; then
    touch "$CASE_ROOT/tried"; return 1
  fi
}
`;
test('update retains the running image, backs up first and pins the new app only', (t) => {
  const { root, run } = fixture(t);
  const result = run(`${updateMocks}\nupdate 0`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(join(root, 'site', '.zweiblog-rollback.yaml'), 'utf8'),
    new RegExp(oldImage),
  );
  assert.match(
    readFileSync(join(root, 'site', '.zweiblog-image.yaml'), 'utf8'),
    new RegExp(newImage),
  );
  const commands = readFileSync(join(root, 'commands'), 'utf8');
  assert.match(
    commands,
    /backup[\s\S]*docker tag[\s\S]*pull zweiblog[\s\S]*up -d --no-deps zweiblog/,
  );
  assert.doesNotMatch(commands, /rmi|down|pull mongo/);
});
test('failed health check persistently restores the previous image and returns failure', (t) => {
  const { root, run } = fixture(t);
  const result = run(`${updateMocks}\nupdate 0`, { UNHEALTHY_UPDATE: '1' });
  assert.notEqual(result.status, 0);
  assert.match(
    readFileSync(join(root, 'site', '.zweiblog-image.yaml'), 'utf8'),
    new RegExp(oldImage),
  );
  assert.match(result.stderr, /恢复上一应用镜像/);
});
test('failed pull never replaces the existing pin or stops the deployment', (t) => {
  const { root, run } = fixture(t);
  writeFileSync(join(root, 'site', '.zweiblog-image.yaml'), 'original pin');
  const result = run(`${updateMocks}\nupdate 0`, { PULL_FAILURE: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(join(root, 'site', '.zweiblog-image.yaml'), 'utf8'), 'original pin');
  assert.doesNotMatch(readFileSync(join(root, 'commands'), 'utf8'), /up -d|down/);
});

test('restore stages a validated snapshot and retains the old data without merging', (t) => {
  const { root, run } = fixture(t);
  mkdirSync(join(root, 'snapshot', 'data'), { recursive: true });
  writeFileSync(join(root, 'snapshot', 'data', 'restored'), 'snapshot record');
  writeFileSync(join(root, 'snapshot', 'docker-compose.yaml'), 'services: {}\n');
  const archive = join(root, 'snapshot.tar.gz');
  assert.equal(
    spawnSync('tar', ['czf', archive, '-C', join(root, 'snapshot'), 'data', 'docker-compose.yaml'])
      .status,
    0,
  );
  const result = run(`${backupMocks}\nrestore_archive "$CASE_ROOT/snapshot.tar.gz"`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /恢复成功/);
  assert.equal(existsSync(join(root, 'site', 'data', 'content')), false);
  assert.equal(readFileSync(join(root, 'site', 'data', 'restored'), 'utf8'), 'snapshot record');
  const retained = readdirSync(join(root, 'site')).find((name) =>
    name.startsWith('zweiblog-before-restore.'),
  );
  assert.equal(
    readFileSync(join(root, 'site', retained, 'data', 'content'), 'utf8'),
    'database fixture',
  );
  assert.equal(readFileSync(join(root, 'state'), 'utf8'), 'stopped');
  assert.doesNotMatch(readFileSync(join(root, 'commands'), 'utf8'), /start /);
});

test('restore refuses malformed archives before stopping services', (t) => {
  const { root, run } = fixture(t);
  writeFileSync(join(root, 'bad.tar.gz'), 'truncated download');
  const result = run(`${backupMocks}\nrestore_archive "$CASE_ROOT/bad.tar.gz"`);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(root, 'commands')), false);
  assert.equal(readFileSync(join(root, 'site', 'data', 'content'), 'utf8'), 'database fixture');
});

test('restore refuses archive links before stopping services', (t) => {
  const { symlinkSync } = require('node:fs');
  const { root, run } = fixture(t);
  symlinkSync('/etc', join(root, 'site', 'data', 'unsafe'));
  const archive = join(root, 'links.tar.gz');
  assert.equal(spawnSync('tar', ['czf', archive, '-C', join(root, 'site'), 'data']).status, 0);
  const result = run(`${backupMocks}\nrestore_archive "$CASE_ROOT/links.tar.gz"`);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(root, 'commands')), false);
  assert.match(result.stderr, /链接或特殊文件/);
});

for (const layout of ['installer', 'compose']) {
  test(`backup and restore retain data, credentials, Caddy state and Mongo assets in ${layout} layout`, (t) => {
    const { root, run } = fixture(t);
    const prefix = layout === 'installer' ? 'data/' : '';
    const paths = [
      `${prefix}data/static/image.png`,
      `${prefix}data/mongo/WiredTiger`,
      `${prefix}secrets/mongo-root-password`,
      `${prefix}secrets/mongo-app-password`,
      `${prefix}secrets/mongo-app-uri`,
      `${prefix}log/app.log`,
      `${prefix}caddy/config/autosave.json`,
      `${prefix}caddy/data/certificate.key`,
      `${prefix}mongo-init.js`,
      `${prefix}mongo-healthcheck.js`,
      `${prefix}setup-mongo-secrets.sh`,
    ];
    for (const [index, path] of paths.entries()) {
      const file = join(root, 'site', path);
      mkdirSync(require('node:path').dirname(file), { recursive: true });
      writeFileSync(file, `fixture-${index}`, { mode: 0o600 });
    }
    const backup = run(`${backupMocks}\nbackup 0`);
    assert.equal(backup.status, 0, backup.stderr);
    const archive = readdirSync(join(root, 'site')).find((name) => name.endsWith('.tar.gz'));
    for (const path of paths) writeFileSync(join(root, 'site', path), 'later data');
    const restore = run(`${backupMocks}\nrestore_archive "$CASE_ROOT/site/${archive}"`);
    assert.equal(restore.status, 0, restore.stderr);
    for (const [index, path] of paths.entries()) {
      assert.equal(readFileSync(join(root, 'site', path), 'utf8'), `fixture-${index}`, path);
    }
  });
}
