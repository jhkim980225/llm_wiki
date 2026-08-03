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
 * ejkim-ontology(30303·30306·30301)와 manager-ontology(30308)는
 * 네임스페이스의 default-deny NetworkPolicy에 막혀 있어 여기 없다.
 */
export const SOURCES: OntologySource[] = [
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

export function findSource(id: string): OntologySource | undefined {
  return SOURCES.find((s) => s.id === id)
}
