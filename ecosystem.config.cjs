// PM2 进程管理配置
// 用于生产环境的进程守护和负载均衡

module.exports = {
  apps: [
    {
      name: 'flatTalk',
      script: 'src/server.js',
      
      // 实例配置
      instances: 'max', // 使用所有 CPU 核心
      exec_mode: 'cluster', // 集群模式
      
      // 环境变量
      env_production: {
        NODE_ENV: 'production',
        FLATTALK_HOST: '0.0.0.0',
        FLATTALK_PORT: 5298,
      },
      
      // 日志配置
      error_file: './data/pm2-error.log',
      out_file: './data/pm2-out.log',
      log_file: './data/pm2-combined.log',
      time: true, // 日志添加时间戳
      merge_logs: true, // 合并日志
      
      // 进程管理
      max_memory_restart: '500M', // 内存超限自动重启
      min_uptime: '10s', // 最小运行时间
      max_restarts: 10, // 最大重启次数
      restart_delay: 1000, // 重启间隔
      autorestart: true, // 自动重启
      watch: false, // 生产环境不监听文件变化
      
      // 健康检查
      kill_timeout: 5000, // 优雅退出超时
      listen_timeout: 3000, // 启动超时
      wait_ready: true, // 等待 ready 信号
    },
  ],
  
  // 部署配置
  deploy: {
    production: {
      user: 'deploy',
      host: ['192.168.1.2'],
      ref: 'origin/main',
      repo: 'git@example.com:flatTalk.git',
      path: '/var/www/flattalk',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.cjs --env production',
      'pre-setup': 'apt-get install git -y',
    },
  },
};