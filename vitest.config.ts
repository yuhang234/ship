import { defineConfig } from 'vitest/config';

/**
 * 测试分两组：
 * - unit：纯函数（日期、文本、frontmatter、搜索），随时可跑；
 * - e2e：只读校验 dist/ 构建产物，需先执行 `npm run build`。
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
        },
      },
    ],
  },
});