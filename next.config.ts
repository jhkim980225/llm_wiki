import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typedRoutes: false,
  // 컨테이너에 넣을 때 node_modules 통째로 안 싣기 위해 standalone 출력을 쓴다.
  output: 'standalone',
}

export default nextConfig
