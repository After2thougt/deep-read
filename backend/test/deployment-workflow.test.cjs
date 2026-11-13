const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const deployDirectory = path.resolve(__dirname, '..', '..', 'deploy');
const readDeployFile = (name) => fs.readFileSync(path.join(deployDirectory, name), 'utf8');

test('migration wrapper pins Admin and Guest paths and targets only the Admin database', () => {
  const migration = readDeployFile('migrate.sh');
  assert.match(migration, /ADMIN_DB_PATH="\/data\/deepread\/app\.db"/);
  assert.match(migration, /GUEST_DB_PATH="\/data\/deepread\/guest\.db"/);
  assert.match(migration, /DATABASE_PATH="\$ADMIN_DB_PATH" GUEST_DATABASE_PATH="\$GUEST_DB_PATH"/);
  assert.match(migration, /--database-path "\$ADMIN_DB_PATH"/);
  assert.match(migration, /"\$ADMIN_DB_PATH" = "\$GUEST_DB_PATH"/);
});

test('first install backs up and migrates before one-time Administrator setup, build, and startup', () => {
  const install = readDeployFile('install.sh');
  const backup = install.indexOf('bash "${APP_DIR}/deploy/backup-db.sh"');
  const migration = install.indexOf('bash "${APP_DIR}/deploy/migrate.sh"');
  const bootstrap = install.indexOf('npm --prefix backend run db:bootstrap-administrator');
  const build = install.indexOf('step "8/11 Building frontend"');
  const start = install.indexOf('pm2 start "$ECOSYSTEM_FILE"');
  const health = install.indexOf('step "Health Checks"');

  assert.ok(install.indexOf('[ -f "$DB_PATH" ] || error') >= 0, 'install must require the existing Admin DB');
  assert.ok(backup >= 0 && backup < migration);
  assert.ok(migration < bootstrap && bootstrap < build && build < start && start < health);
  assert.match(install, /Admin database backup failed; migrations were not run/);
  assert.match(install, /Admin database migration failed; build and startup were stopped/);
  assert.match(install, /ACTIVE_ADMINISTRATOR_COUNT/);
  assert.doesNotMatch(install, /AUTH_SESSION_SECRET=\$\(openssl rand/);
});

test('daily update backs up and migrates before build/restart without invoking Administrator bootstrap', () => {
  const update = readDeployFile('update.sh');
  const pull = update.indexOf('git pull --ff-only origin "$BRANCH"');
  const dependencies = update.indexOf('npm ci');
  const backup = update.indexOf('bash "${APP_DIR}/deploy/backup-db.sh"');
  const migration = update.indexOf('bash "${APP_DIR}/deploy/migrate.sh"');
  const build = update.indexOf('npm run build');
  const restart = update.indexOf('pm2 restart "$PM2_NAME" --update-env');
  const health = update.indexOf('curl -sf "$HEALTH_ENDPOINT"');
  const bootstrapReminder = update.split(/\r?\n/).find((line) => line.includes('db:bootstrap-administrator'));

  assert.ok(pull >= 0 && pull < dependencies && dependencies < backup);
  assert.ok(backup < migration && migration < build && build < restart && restart < health);
  assert.match(update, /Admin database backup failed; migrations and restart were stopped/);
  assert.match(update, /Admin database migration failed; build and restart were stopped/);
  assert.ok(bootstrapReminder, 'update should remind but never invoke Administrator bootstrap');
  assert.match(bootstrapReminder, /^\s*warn /);
});

test('automatic deployment delegates to the guarded update workflow', () => {
  const automatic = readDeployFile('deepread-deploy.sh');
  assert.match(automatic, /bash "\$APP_DIR\/deploy\/update\.sh" main/);
  assert.doesNotMatch(automatic, /git reset --hard/);
  assert.doesNotMatch(automatic, /db:bootstrap-administrator/);
});
