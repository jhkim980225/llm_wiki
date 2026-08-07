import type { NextConfig } from 'next'

/**
 * cloud.fedaground.com/graphwiki 경로 배포용 접두사.
 * 바꾸면 src/components/BasePathFetch.tsx의 BASE와 deploy/k8s.yaml(인그레스·probe)도 같이 바꾼다.
 */
const BASE_PATH = '/graphwiki'

const nextConfig: NextConfig = {
  typedRoutes: false,
  // 컨테이너에 넣을 때 node_modules 통째로 안 싣기 위해 standalone 출력을 쓴다.
  output: 'standalone',
  basePath: BASE_PATH,
  async redirects() {
    return [
      // 접두사 없는 옛 주소·본문 원시 앵커(미들클릭)·NodePort 루트 전부 새 경로로.
      // _next/asset 요청은 basePath 아래로만 오므로 여기 걸리지 않는다.
      {
        source: '/:path((?!graphwiki).*)',
        destination: `${BASE_PATH}/:path`,
        permanent: false,
        basePath: false,
      },
    ]
  },
}

export default nextConfig
