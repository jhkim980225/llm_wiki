export type DiffLine = { type: 'same' | 'add' | 'del'; text: string }

/**
 * 줄 단위 LCS diff. 리비전 비교와 저장 충돌 화면에서 쓴다.
 * ponytail: O(n*m) 표를 채운다. 리비전 본문은 수천 줄을 넘지 않으니 충분하다.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')

  // lcs[i][j] = a[i..], b[j..]의 최장 공통 부분수열 길이
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'del', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < a.length) out.push({ type: 'del', text: a[i++] })
  while (j < b.length) out.push({ type: 'add', text: b[j++] })

  return out
}
