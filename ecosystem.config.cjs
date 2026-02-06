module.exports = {
  apps: [{
    name: 'meal-planner',
    script: 'dist/server.js',
    env: {
      NODE_ENV: 'production'
    },
    // watch: true,
    ignore_watch: [
      'node_modules',
      'logs',
      'src',
      'tests',
      'scripts',
      'public',
      'magtag',
      'docs',
      'coverage',
      '.git',
      '.claude',
      '*.md',
      '*.db',
      '*.db-wal',
      '*.db-shm',
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'vitest.config.ts',
      'ecosystem.config.cjs'
    ],
    watch_delay: 1000,

    // PM2 logs go to ~/.pm2/logs/ by default (outside project dir).
    // View formatted output with: pm2 logs --raw | pino-pretty
    log_date_format: ''
  }]
};
