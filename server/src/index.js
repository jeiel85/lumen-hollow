// Cloudflare Worker 진입점. 규칙과 라우팅은 app.js에 있다.
import { createApp } from './app.js';

const app = createApp();

export default {
  fetch: (request, env) => app.fetch(request, env),
  scheduled: (event, env, ctx) => {
    ctx.waitUntil(app.scheduled(env));
  },
};
