'use client'
import {
  CircleHelp,
  FileText,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  Waypoints,
} from 'lucide-react'
import { EmptyStateAction } from '@/components/ui'

/**
 * 들머리 = 사이드바 사용 가이드. 각 항목을 클릭하면 해당 화면으로 넘어간다.
 * 왼쪽 정렬 온보딩 스타일은 docs/design.md '빈 문서 화면' 기준.
 */
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
          <p className="lead">
            사내 지식 그래프를 문서로 읽고, 연결하고, AI로 정리하는 워크스페이스입니다.
            아래 항목을 누르면 해당 화면으로 이동합니다.
          </p>

          <div className="action-list">
            <EmptyStateAction
              icon={<FileText size={16} aria-hidden />}
              title="문서"
              desc="왼쪽 트리에서 문서와 폴더를 만들고 정리합니다. Ctrl+N 새 문서, 드래그로 이동, Ctrl+K로 전체 검색. 클릭하면 새 문서를 만듭니다."
              onClick={() => {
                // 새 문서 흐름은 트리의 '새 문서'와 동일 — Ctrl+N 핸들러(FileTree)가 받는다.
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }))
              }}
            />
            <EmptyStateAction
              icon={<Waypoints size={16} aria-hidden />}
              title="그래프"
              desc="문서 사이의 [[링크]] 연결을 한눈에 봅니다. 노드를 선택하면 오른쪽에 상세 정보가 뜨고, 바로 문서로 이동할 수 있습니다."
              href="/graph"
            />
            <EmptyStateAction
              icon={<Sparkles size={16} aria-hidden />}
              title="AI 작성"
              desc="질문을 입력하면 사내 지식 그래프와 위키를 조회해 근거·출처가 포함된 문서 초안을 만들고 자동 저장합니다."
              href="/ask"
            />
            <EmptyStateAction
              icon={<Trash2 size={16} aria-hidden />}
              title="휴지통"
              desc="삭제한 문서와 폴더가 7일간 보관됩니다. 복원하거나 즉시 비울 수 있습니다."
              href="/trash"
            />
            <EmptyStateAction
              icon={<CircleHelp size={16} aria-hidden />}
              title="가이드"
              desc="전체 사용자 매뉴얼을 사이트 안에서 봅니다. 화면별 사용법과 단축키가 캡처와 함께 정리되어 있습니다."
              href="/guide"
            />
            <EmptyStateAction
              icon={<SettingsIcon size={16} aria-hidden />}
              title="설정"
              desc="그래프 연결·LLM 상태 확인, 온톨로지 소스별 가져오기, 로그아웃. 상태 탭의 '가져오기'가 개체를 문서로 들여옵니다."
              onClick={() => window.dispatchEvent(new Event('wiki:open-settings'))}
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
