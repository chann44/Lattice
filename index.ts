import { createApp } from "./src/app";
import { loadConfig } from "./src/config";

const config = loadConfig();
const { app } = await createApp(config);

Bun.serve({
  port: config.port,
  fetch: app.fetch,
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`Agent-SCM listening on :${config.port}`);
