import { db } from '@/lib/db'

/** 무한 루프 방지용 상한. 정상 위키에서 이보다 깊은 폴더 체인은 없다. */
const MAX_CHAIN = 64

/**
 * folderId를 newParentId 밑으로 옮기면 순환이 생기는지.
 * 자기 자신이거나, newParent의 조상 체인에 folderId가 있으면 순환이다.
 */
export async function wouldCycle(folderId: string, newParentId: string | null): Promise<boolean> {
  if (!newParentId) return false
  if (newParentId === folderId) return true

  let cursor: string | null = newParentId
  for (let i = 0; i < MAX_CHAIN && cursor; i++) {
    if (cursor === folderId) return true
    const f: { parentId: string | null } | null = await db.folder.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    })
    if (!f) return false
    cursor = f.parentId
  }
  return false
}

/** 루트부터 이 폴더까지의 이름 체인. 루트(null)는 빈 배열. */
export async function folderPath(folderId: string | null): Promise<string[]> {
  const names: string[] = []
  let cursor = folderId
  for (let i = 0; i < MAX_CHAIN && cursor; i++) {
    const f = await db.folder.findUnique({
      where: { id: cursor },
      select: { name: true, parentId: true },
    })
    if (!f) break
    names.unshift(f.name)
    cursor = f.parentId
  }
  return names
}
