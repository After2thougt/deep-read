const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run db:restore -- /absolute/path/to/backup.db');
  process.exit(1);
}

const source = path.resolve(input);
const destination = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'data', 'app.db'));
if (!fs.existsSync(source)) {
  console.error('Backup file does not exist.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(destination), { recursive: true });
const beforeRestore = path.join(path.dirname(destination), 'backups', `pre-restore-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.db`);
fs.mkdirSync(path.dirname(beforeRestore), { recursive: true });
if (fs.existsSync(destination)) {
  execFileSync(process.execPath, [path.join(__dirname, 'backup.js')], { stdio: 'inherit', env: process.env });
}
fs.copyFileSync(source, destination);
for (const suffix of ['-wal', '-shm']) {
  const sidecar = `${destination}${suffix}`;
  if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
}
console.log(`Restored ${source} to ${destination}. Restart the application after restore.`);
