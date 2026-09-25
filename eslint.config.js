// ============================================================================
// eslint.config.js —— ESLint 9/10 扁平配置（flat config）
//   - 浏览器全局环境（src 为纯浏览器模块）
//   - 测试文件补 node/vitest 全局
//   - 规则取向：发现真实问题、不制造噪音（不启用需要大改代码的激进规则）
// ============================================================================
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  // 忽略构建产物与依赖目录
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },

  // 通用推荐规则
  js.configs.recommended,

  // 浏览器源码（src、index.html 内联脚本若后续引入也走这里）
  {
    files: ['src/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // 未使用变量：只看最后一个已用参数之后的参数，_ 前缀视为有意忽略
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        // catch 到的异常默认不报（吞异常属于提交点 4 的人工处理范畴）
        caughtErrors: 'none',
      }],
      // 空块允许空 catch（静默兜底在提交点 4 逐个改为可见提示）
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 用到但未声明的标识符（no-undef 依赖 globals 环境声明）
      'no-undef': 'error',
      // 抛错时保留原始异常：提交点 4 为两处 catch 补 cause 后恢复为默认（error）
      'preserve-caught-error': 'off',
    },
  },

  // 测试运行在 node 环境（vitest），补 node 全局
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // 配置文件（vite / vitest / eslint 自身）跑在 node
  {
    files: ['*.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },

  // 关闭与 Prettier 冲突的格式类规则
  prettier,
];
