/** 랜딩 없음. 왼쪽에서 문서를 고르면 된다. */
export default function Home() {
  return (
    <>
      <div className="tabbar">
        <span className="center">열린 문서 없음</span>
      </div>
      <div className="empty">왼쪽에서 문서를 고르거나 Ctrl+K로 검색</div>
    </>
  )
}
