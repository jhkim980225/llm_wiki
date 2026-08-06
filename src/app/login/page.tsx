'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, ChevronDown, Eye, EyeOff, ShieldCheck, Waypoints } from 'lucide-react'
import { LOGIN_ID_RE } from '@/lib/auth/password'
import { toast } from '@/lib/toast'
import { version } from '../../../package.json'

/** 배경 장식 — 문서 노드 그래프 패턴. 아주 낮은 투명도, 왼쪽 하단 고정. */
function GraphPattern() {
  const nodes: [number, number][] = [
    [40, 300], [130, 240], [90, 150], [210, 180], [180, 70], [300, 120], [280, 260], [380, 200],
  ]
  const edges: [number, number][] = [
    [0, 1], [1, 2], [1, 3], [2, 4], [3, 4], [3, 5], [3, 6], [5, 7], [6, 7],
  ]
  return (
    <svg className="login-pattern" width="420" height="340" aria-hidden>
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]}
          stroke="currentColor" strokeWidth="1"
        />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 3 ? 7 : 4} fill="currentColor" />
      ))}
    </svg>
  )
}

type WorkspaceOption = { id: string; name: string; slug: string; role: string }

export default function LoginPage() {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [fieldErr, setFieldErr] = useState<{ loginId?: string; password?: string }>({})
  const [topErr, setTopErr] = useState('')
  // 기본 워크스페이스가 없고 소속이 여럿일 때만 선택 UI가 뜬다
  const [choices, setChoices] = useState<WorkspaceOption[] | null>(null)
  const router = useRouter()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return

    const errs: typeof fieldErr = {}
    if (!LOGIN_ID_RE.test(loginId.trim())) errs.loginId = '아이디는 4~50자의 영문·숫자·._-만 허용됩니다.'
    if (!password) errs.password = '비밀번호를 입력하세요.'
    setFieldErr(errs)
    setTopErr('')
    if (Object.keys(errs).length > 0) return

    setBusy(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId, password, rememberMe: remember }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = body.message ?? `요청에 실패했습니다 (HTTP ${res.status})`
        setTopErr(message)
        // 잠금·rate limit은 상태가 바뀐 것이라 토스트로도 강조한다. 단순 오답은 인라인만.
        if (res.status === 423 || res.status === 429) toast(message, 'error')
        return
      }
      if (!body.workspace && Array.isArray(body.workspaces) && body.workspaces.length > 0) {
        setChoices(body.workspaces)
        return
      }
      toast(`환영합니다, ${body.user?.displayName || body.user?.loginId || ''}님`, 'success')
      router.replace('/')
    } catch {
      setTopErr('서버에 연결할 수 없습니다.')
      toast('서버에 연결할 수 없습니다.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const pickWorkspace = async (workspaceId: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/switch-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      if (res.ok) {
        toast('워크스페이스에 접속했습니다.', 'success')
        router.replace('/')
      } else {
        setTopErr('워크스페이스 진입에 실패했습니다.')
        toast('워크스페이스 진입에 실패했습니다.', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <div className="login-body">
        {/* 왼쪽 — 브랜드 안내 */}
        <section className="login-brand">
          <GraphPattern />
          <div className="logo">
            <span className="mark">
              <Waypoints size={15} aria-hidden />
            </span>
            주식회사 성진
          </div>

          <div className="pitch">
            <h1>
              문서와 그래프를 연결해
              <br />
              지식을 관리하세요
            </h1>
            <p className="lead">
              신뢰할 수 있는 문서와 데이터를 연결하고, 구조화된 지식으로 만들어
              <br />팀의 생산성을 높여줍니다.
            </p>

            <div className="feats">
              <div className="feat">
                <Waypoints size={18} aria-hidden />
                <div>
                  <strong>연결된 지식</strong>
                  <p>문서, 데이터, 개념을 그래프로 연결해 숨겨진 관계와 인사이트를 발견하세요.</p>
                </div>
              </div>
              <div className="feat">
                <ShieldCheck size={18} aria-hidden />
                <div>
                  <strong>안전한 협업</strong>
                  <p>권한 기반 보호와 감사 로그를 통해 안전하고 효율적인 협업을 지원합니다.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 오른쪽 — 로그인 카드 */}
        <section className="login-side">
          {choices ? (
            <div className="login-card">
              <h2>워크스페이스 선택</h2>
              <p className="sub">접속할 워크스페이스를 선택하세요.</p>
              <div className="ws-list">
                {choices.map((w) => (
                  <button key={w.id} type="button" disabled={busy} onClick={() => pickWorkspace(w.id)}>
                    <Building2 size={15} aria-hidden />
                    <span className="n">{w.name}</span>
                    <span className="r">{w.role}</span>
                  </button>
                ))}
              </div>
              <p className="top-err" role="alert" aria-live="polite">
                {topErr}
              </p>
            </div>
          ) : (
            <form className="login-card" onSubmit={submit} noValidate>
              <div className="ws" role="note" aria-label="워크스페이스">
                <Building2 size={14} aria-hidden />
                온톨로지 프로젝트
                <ChevronDown size={13} aria-hidden />
              </div>

              <h2>로그인</h2>
              <p className="sub">주식회사 성진 워크스페이스에 접속하세요.</p>

              {/* 오류가 나도 레이아웃이 안 밀리게 자리를 항상 잡아둔다 */}
              <p className="top-err" role="alert" aria-live="polite">
                {topErr}
              </p>

              <label className="field">
                아이디
                <input
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="아이디를 입력하세요"
                  autoComplete="username"
                  autoFocus
                  aria-invalid={Boolean(fieldErr.loginId)}
                />
                <span className="err">{fieldErr.loginId}</span>
              </label>

              <label className="field">
                비밀번호
                <span className="pw-wrap">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="비밀번호를 입력하세요"
                    autoComplete="current-password"
                    aria-invalid={Boolean(fieldErr.password)}
                  />
                  <button
                    type="button"
                    className="pw-toggle"
                    aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 표시'}
                    onClick={() => setShowPw((v) => !v)}
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </span>
                <span className="err">{fieldErr.password}</span>
              </label>

              <div className="row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  로그인 상태 유지
                </label>
                <button
                  type="button"
                  className="link"
                  onClick={() => setTopErr('비밀번호 초기화는 관리자에게 문의하세요.')}
                >
                  비밀번호를 잊으셨나요?
                </button>
              </div>

              <button className="submit" type="submit" disabled={busy}>
                {busy ? '로그인 중...' : '로그인'}
              </button>

              <p className="swap">계정이 필요한 경우 관리자에게 문의하세요.</p>
            </form>
          )}
        </section>
      </div>

      <footer className="login-foot">
        <span>© 2026 주식회사 성진. All rights reserved.</span>
        <span>
          보안 · 개인정보 처리방침 · 이용약관 · v{version}
        </span>
      </footer>
    </main>
  )
}
