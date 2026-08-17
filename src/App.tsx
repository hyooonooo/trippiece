import { FormEvent, useState } from 'react'
import './App.css'

type Place = {
  id: string
  name: string
  category: string
  categoryGroup: string
  address: string
  lat: number
  lng: number
  phone: string
  url: string
}

type Segment = {
  fromPlaceId: string
  toPlaceId: string
  meters: number
  walkMinutes: number
}

type Course = {
  id: string
  label: string
  title: string
  stops: Place[]
  segments: Segment[]
  totalDistance: number
  totalWalkMinutes: number
}

type CourseResponse = {
  area: string
  source: 'kakao'
  generatedAt: string
  counts: {
    activity: number
    cafe: number
    food: number
  }
  courses: Course[]
}

const API_BASE =
  import.meta.env.DEV ? 'https://trippiece.pages.dev' : ''

function App() {
  const [area, setArea] = useState('성수')
  const [vibe, setVibe] = useState('balanced')
  const [data, setData] = useState<CourseResponse | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const searchCourses = async (event?: FormEvent) => {
    event?.preventDefault()

    const trimmedArea = area.trim()
    if (!trimmedArea) return

    setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams({
        area: trimmedArea,
        vibe,
      })

      const response = await fetch(
        `${API_BASE}/api/course?${params.toString()}`,
      )

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '코스를 만들지 못했습니다.')
      }

      setData(result)
      setSelectedIndex(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const selectedCourse = data?.courses[selectedIndex]

  return (
    <main className="app">
      <header className="topbar">
        <strong>trippiece</strong>
        <span>실제 장소 데이터</span>
      </header>

      <section className="hero">
        <p className="kicker">KAKAO LOCAL 기반</p>
        <h1>어디에서<br />데이트할까?</h1>
        <p className="subtitle">
          지역을 입력하면 실제 영업 장소를 검색해서 코스를 조합합니다.
        </p>
      </section>

      <form className="search-panel" onSubmit={searchCourses}>
        <label>
          지역
          <input
            value={area}
            onChange={(event) => setArea(event.target.value)}
            placeholder="성수, 연남, 한남..."
          />
        </label>

        <label>
          오늘의 방향
          <select
            value={vibe}
            onChange={(event) => setVibe(event.target.value)}
          >
            <option value="balanced">균형 있게</option>
            <option value="culture">전시 / 문화</option>
            <option value="nature">산책 / 자연</option>
          </select>
        </label>

        <button className="primary" disabled={loading}>
          {loading ? '실제 장소 검색 중…' : '실제 코스 만들기'}
        </button>
      </form>

      {error && (
        <section className="error-box">
          <strong>불러오지 못했습니다.</strong>
          <p>{error}</p>
        </section>
      )}

      {data && data.courses.length === 0 && (
        <section className="empty-box">
          이 지역에서는 코스를 만들 만큼 장소를 찾지 못했습니다.
        </section>
      )}

      {data && data.courses.length > 0 && selectedCourse && (
        <section className="results">
          <div className="result-heading">
            <div>
              <p>{data.area}</p>
              <h2>실제 장소로 만든 코스</h2>
            </div>
            <span>
              후보 {data.counts.activity + data.counts.cafe + data.counts.food}곳
            </span>
          </div>

          <div className="tabs">
            {data.courses.map((course, index) => (
              <button
                key={course.id}
                className={index === selectedIndex ? 'active' : ''}
                onClick={() => setSelectedIndex(index)}
              >
                {index + 1}
                <small>{course.label}</small>
              </button>
            ))}
          </div>

          <article className="course">
            <div className="course-head">
              <h3>{selectedCourse.title}</h3>
              <div>
                도보 약 {selectedCourse.totalWalkMinutes}분 ·{' '}
                {(selectedCourse.totalDistance / 1000).toFixed(1)}km
              </div>
            </div>

            <ol className="timeline">
              {selectedCourse.stops.map((place, index) => {
                const nextSegment = selectedCourse.segments[index]

                return (
                  <li key={place.id}>
                    <div className="number">{index + 1}</div>

                    <div className="place">
                      <span className="category">
                        {place.categoryGroup || '장소'}
                      </span>
                      <h4>{place.name}</h4>
                      <p>{place.address}</p>

                      <div className="place-actions">
                        <a
                          href={place.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          카카오맵에서 보기 ↗
                        </a>

                        {place.phone && <span>{place.phone}</span>}
                      </div>

                      {nextSegment && (
                        <div className="travel">
                          다음 장소까지 직선거리{' '}
                          {nextSegment.meters >= 1000
                            ? `${(nextSegment.meters / 1000).toFixed(1)}km`
                            : `${nextSegment.meters}m`}
                          {' · '}
                          도보 추정 {nextSegment.walkMinutes}분
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </article>

          <p className="source-note">
            장소명·주소·좌표는 Kakao Local API 응답입니다. 현재 이동시간은
            좌표 간 거리 기반 추정치이며 실제 길찾기는 다음 단계에서 연결합니다.
          </p>
        </section>
      )}
    </main>
  )
}

export default App
