// 개발 전용 시드 — test/test 계정 + 온톨로지 프로젝트 워크스페이스.
// 운영(NODE_ENV=production)에서는 아무것도 만들지 않는다.
// 실행: npx prisma db seed
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.log('production — seed 생략')
    return
  }

  const workspace = await db.workspace.upsert({
    where: { slug: 'ontology-project' },
    update: {},
    create: { name: '온톨로지 프로젝트', slug: 'ontology-project' },
  })

  const existing = await db.user.findUnique({ where: { loginId: 'test' } })
  if (existing) {
    console.log('test 계정 이미 존재 — 생략')
    return
  }

  // 테스트 목적으로만 비밀번호 정책(8자·2종)을 우회한다. 운영 금지.
  const user = await db.user.create({
    data: {
      loginId: 'test',
      passwordHash: bcrypt.hashSync('test', 12),
      displayName: '테스트 사용자',
      mustChangePassword: false,
      memberships: {
        create: { workspaceId: workspace.id, role: 'WORKSPACE_ADMIN', isDefault: true },
      },
    },
  })
  console.log(`created: ${user.loginId} @ ${workspace.name}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
