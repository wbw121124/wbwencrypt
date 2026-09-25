// ============================================================================
// vitest.config.js —— 单元测试配置
//   加密核心依赖 Node 自带的 WebCrypto（Node 24 原生提供 crypto.subtle），
//   因此默认使用 node 环境，无需 jsdom。
// ============================================================================
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // 每个测试文件独立进程，避免 src 模块级状态互相污染
    isolate: true,
  },
});
