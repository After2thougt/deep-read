// PM2 Ecosystem Configuration for DeepRead
// Usage: pm2 start deploy/ecosystem.config.js

const path = require('path');

const APP_ROOT = '/opt/deepread/app';
const ENV_FILE = path.join(APP_ROOT, '.env');

module.exports = {
  apps: [
    {
      name: 'deepread',
      script: 'backend/server.js',
      cwd: APP_ROOT,
      env_file: ENV_FILE,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3000,
        DATABASE_PATH: '/data/deepread/app.db',
      },
      // Restart if memory exceeds 500MB
      max_memory_restart: '500M',
      // Restart delay on crash
      restart_delay: 3000,
      // Max restarts in a 60s window before stopping
      max_restarts: 10,
      min_uptime: '10s',
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      out_file: '/dev/null',
      error_file: '/dev/null',
      // Wait for app to be ready
      wait_ready: false,
      listen_timeout: 5000,
      kill_timeout: 5000,
    },
  ],
};