'use client'
import { FilePlus2, MessageSquareText, Sparkles } from 'lucide-react'
import { EmptyStateAction } from '@/components/ui'

/** 들머리 — 왼쪽 정렬 온보딩 (docs/design.md '빈 문서 화면'). */
export default function Home() {
  return (
    <>
      <div className="tabbar">
        <div className="tabs" />
        <span className="center" />
        <span className="side meta">문서를 열면 탭이 여기에 표시됩니다</span>
      </div>
      <div className="doc" style={{ padding: 0 }}>
        <div className="onboard">
          <h1>주식회사 성진 위키 시작하기</h1>
          <p className="lead">문서를 직접 쓰거나, 사내 지식 그래프에서 찾아 문서로 만듭니다.</p>

          <div className="action-list">
            <EmptyStateAction
              icon={<Sparkles size={16} aria-hidden />}
              title="자연어로 문서 만들기"
              desc="질문을 입력하면 그래프를 조회하고 출처가 포함된 문서 초안을 생성합니다."
              href="/ask"
            />
            <EmptyStateAction
              icon={<FilePlus2 size={16} aria-hidden />}
              title="새 문서 작성"
              desc="빈 문서를 생성하고 직접 내용을 작성합니다. Ctrl+N으로도 만들 수 있습니다."
              onClick={() => {
                // 새 문서 흐름은 트리의 '새 문서'와 동일 — Ctrl+N 핸들러(FileTree)가 받는다.
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }))
              }}
            />
            <EmptyStateAction
              icon={<MessageSquareText size={16} aria-hidden />}
              title="도우미 열기"
              desc="현재 문서, 연결 노드, 출처를 기반으로 질문합니다."
              href="/chat"
            />
          </div>

          <div className="keys">
            <span>
              <kbd>Ctrl</kbd>
              <kbd>K</kbd> 전체 검색
            </span>
            <span>
              <kbd>Ctrl</kbd>
              <kbd>N</kbd> 새 문서
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
