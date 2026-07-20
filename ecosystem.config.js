module.exports = {
  apps: [
    {
      name: 'dating-server',
      script: 'src/index.js',
      instances: '6',
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      cron_restart: '0 2 * * *',
      env: {
        NODE_ENV: 'production',
        UV_THREADPOOL_SIZE: 128,
      },
      time: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 10000,
      kill_timeout: 5000,
      restart_delay: 4000,
      exp_backoff_restart_delay: 100,
    },
  ],
};
