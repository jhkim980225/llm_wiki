import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import path from 'node:path'

// 테스트는 .env.test의 DATABASE_URL(별도 wiki_test DB)을 쓴다.
// 테스트가 테이블을 통째로 비우므로 개발용 DB를 가리키면 안 된다.
const env = { ...loadEnv('', process.cwd(), ''), ...loadEnv('test', process.cwd(), '') }

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env,
    // DB 테스트가 같은 테이블을 지우고 시작하므로 파일 병렬 실행을 막는다.
    fileParallelism: false,
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
