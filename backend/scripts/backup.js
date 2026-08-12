const fs = require('fs');
const path = require('path');
const { db } = require('../db');

const source = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'data', 'app.db'));
const backupDirectory = path.join(path.dirname(source), 'backups');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const destination = path.join(backupDirectory, `app-${stamp}.db`);

fs.mkdirSync(backupDirectory, { recursive: true });
db.backup(destination)
  .then(() => console.log(destination))
  .catch((error) => {
    console.error('Database backup failed.');
    process.exitCode = 1;
  });
