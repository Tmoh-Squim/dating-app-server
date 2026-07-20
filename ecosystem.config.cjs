module.exports = {
  apps: [
    {
      name: "proximo-server",
      script: "./src/index.js",
      instances: "max",
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
