/**
 * 온톨로지 소스 하나. 사내에 Fuseki가 여러 대 떠 있고 각자 다른 네임스페이스를
 * 쓰므로, 어휘의 차이는 전부 이 설정으로 흡수한다. 코드는 소스를 구분하지 않는다.
 */
export type OntologySource = {
  /** slug 앞머리이자 폴더 이름. 소문자 영숫자만. */
  id: string
  /** 사람이 읽는 이름 */
  name: string
  /** 예: http://192.168.0.100:30310 */
  url: string
  /** 예: ontology */
  dataset: string
  /** 관계 술어의 접두사. 이걸로 시작하면 엣지, 아니면 속성으로 본다. */
  relationNamespace: string
  /** 표시명 술어. 대부분 rdfs:label. */
  labelPredicate: string
  /** 인증이 걸린 소스용 */
  user?: string
  password?: string
}

export const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'

/**
 * 2026-08-04 기준 사내에서 접근 가능한 소스.
 *
 * 주의: NodePort라도 **파드가 도는 노드**로 붙어야 하는 것이 있다. ejkim-ontology는
 * 네임스페이스에 default-deny NetworkPolicy가 걸려 있어 다른 노드를 거쳐 오는 트래픽은
 * 막히고, 파드가 있는 fedaworker12(192.168.0.114)로 직접 가면 통과한다.
 *
 * kakao(30301)는 **개발 PC에서만** 안 붙는다. 서비스도 파드도 멀쩡하다(실측 2026-08-04:
 * fuseki-kakao-0 Running, 엔드포인트 정상, fedaworker12 — ejkim과 같은 노드).
 * 정책의 허용 대역 차이 하나뿐이다:
 *   fuseki-allow-required-traffic (30303) → 192.168.0.0/16 + 10.8.0.0/24 (VPN)
 *   fuseki-kakao-allow            (30301) → 192.168.0.0/16 만
 * VPN 클라이언트(10.8.0.x)가 빠져 있어 패킷이 조용히 버려진다.
 * 클러스터 안에서 NodePort로 부르면 노드 IP로 SNAT돼 192.168.0.0/16에 걸려 통과한다.
 * 개발 PC에서도 쓰려면 소유자에게 10.8.0.0/24 추가를 요청해야 한다.
 */
export const SOURCES: OntologySource[] = [
  {
    id: 'ejkim',
    name: '이메일 온톨로지',
    url: process.env.ONTOLOGY_EJKIM_URL || 'http://192.168.0.114:30303',
    dataset: 'ontology',
    relationNamespace: 'urn:ejkim:ontology:',
    labelPredicate: RDFS_LABEL,
  },
  {
    id: 'kakao',
    name: '카카오 지식그래프',
    url: process.env.ONTOLOGY_KAKAO_URL || 'http://192.168.0.114:30301',
    dataset: 'ontology',
    relationNamespace: 'urn:feda:kg:vocab/',
    labelPredicate: RDFS_LABEL,
  },
  {
    id: 'seunghoon',
    name: '승훈 온톨로지',
    url: process.env.ONTOLOGY_SEUNGHOON_URL || 'http://192.168.0.100:30310',
    dataset: 'ontology',
    relationNamespace: 'http://seunghoon-ontology/schema#',
    labelPredicate: RDFS_LABEL,
  },
  {
    id: 'weknora',
    name: 'LLM 위키 그래프',
    url: process.env.FUSEKI_URL || 'http://192.168.0.100:31406',
    dataset: process.env.FUSEKI_DATASET || 'ds',
    relationNamespace: 'urn:weknora:rel:',
    labelPredicate: RDFS_LABEL,
  },
]

/**
 * LLM이 실시간으로 물어보는 소스. weknora는 이 앱 자신의 데이터셋이고 비어 있어서
 * 지식 출처가 아니다 — 적재 대상으로만 남긴다.
 */
export const QUERY_SOURCES: OntologySource[] = SOURCES.filter((s) => s.id !== 'weknora')

export function findSource(id: string): OntologySource | undefined {
  return SOURCES.find((s) => s.id === id)
}
