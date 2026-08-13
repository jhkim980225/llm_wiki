/**
 * 타입을 몰라도(kakao — 어휘 미확인) 라벨만으로 값 조각을 거른다.
 * "국민은행 497801-01-293617"·"31,000원"·"010-8288-2107"·"2026-06-22" 류 —
 * 공백 뺀 글자 중 숫자·구분 기호가 절반을 넘으면 이름이 아니라 값이다.
 *
 * 여기 두는 이유: 그래프(서버)와 개체 요약 카드(클라이언트)가 같이 쓴다.
 * graph-ref/graph.ts에 두면 SPARQL 모듈 전체가 클라이언트 번들로 딸려 온다.
 */
export function isNoiseLabel(label: string): boolean {
  const chars = label.replace(/\s/g, '')
  if (!chars) return false
  const numeric = (chars.match(/[\d\-–.,:()/원₩%~]/g) ?? []).length
  return numeric / chars.length > 0.5
}
