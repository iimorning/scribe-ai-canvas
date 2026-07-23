import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {volcAsrProxyPlugin} from './vite-plugins/volcAsrProxyPlugin';

/** 与 tp- Token 套餐控制台一致；开发代理转发到此前缀 */
const MIMO_PROXY_TARGET = 'https://token-plan-cn.xiaomimimo.com/v1';
/** DeepSeek OpenAI-compatible API proxy target */
const DEEPSEEK_PROXY_TARGET = 'https://api.deepseek.com/v1';
/** 秘塔搜索 API 代理目标 */
const METASO_PROXY_TARGET = 'https://metaso.cn';
/** Volcengine Ark (Doubao) OpenAI-compatible API proxy target */
const DOUBAO_PROXY_TARGET = 'https://ark.cn-beijing.volces.com/api/v3';
/** MiniMax OpenAPI (China) */
const MINIMAX_PROXY_TARGET = 'https://api.minimaxi.com';

const apiProxy = {
  '/api/mimo': {
    target: MIMO_PROXY_TARGET,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/mimo/, ''),
  },
  '/api/deepseek': {
    target: DEEPSEEK_PROXY_TARGET,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/deepseek/, ''),
  },
  '/api/doubao': {
    target: DOUBAO_PROXY_TARGET,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/doubao/, ''),
  },
  '/api/metaso': {
    target: METASO_PROXY_TARGET,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/metaso/, ''),
  },
  '/api/minimax': {
    target: MINIMAX_PROXY_TARGET,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api\/minimax/, ''),
  },
};

export default defineConfig(({mode, command}) => {
  const env = loadEnv(mode, '.', '');
  const hostedDoubaoKey = (env.VITE_BUILTIN_DOUBAO_API_KEY ?? '').trim();
  if (command === 'build' && !hostedDoubaoKey) {
    console.warn(
      '\n[Spoor] VITE_BUILTIN_DOUBAO_API_KEY is not set — the built site will NOT include hosted Doubao for end users.\n' +
        '  Local: npm run setup:doubao-key -- ark-... then npm run build\n' +
        '  Netlify: Site configuration → Environment variables → add VITE_BUILTIN_DOUBAO_API_KEY → redeploy\n',
    );
  }
  return {
    plugins: [react(), tailwindcss(), volcAsrProxyPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: apiProxy,
    },
    preview: {
      proxy: apiProxy,
    },
  };
});