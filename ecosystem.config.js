// PM2 process definition for the Tailscale App Hub.
//   pm2 start ecosystem.config.js   -> start the hub
//   pm2 stop tailscale-hub          -> stop
//   pm2 logs tailscale-hub          -> view logs
//   pm2 startup                     -> generate the auto-start-on-login command
//   pm2 save                        -> persist the process list
//
// Environment is loaded by server.js from .env via dotenv, so we don't
// duplicate secrets here.
module.exports = {
  apps: [
    {
      name: "tailscale-hub",
      script: "server.js",
      watch: false,
      restart_delay: 3000,
      max_restarts: 10,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
