import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

declare global {
  interface Window {
    L: any
  }
}

type Tab = 'map' | 'saved' | 'route' | 'routes'
type CategoryId = 'all' | 'cafe' | 'food' | 'culture' | 'park' | 'bar' | 'shop'

type Place = {
  id: string
  provider: 'kakao'
  providerPlaceId: string
  name: string
  category: string
  categoryGroup: string
  categoryGroupCode: string
  address: string
  lat: number
  lng: number
  phone: string
  url: string
  distance: number | null
}

type RouteInfo = {
  source: 'kakao'
  totalDistance: number
  totalTime: number
  landingUrl: string
  legs: { distance: number; time: number }[]
  points: { lat: number; lng: number }[]
}

type SavedRoute = {
  id: string
  title: string
  stops: Place[]
  routeInfo: RouteInfo | null
  createdAt: string
}

const API_BASE = import.meta.env.DEV ? 'https://trippiece.pages.dev' : ''
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }
const MAX_ROUTE_STOPS = 7

const categories: { id: CategoryId; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'cafe', label: '카페' },
  { id: 'food', label: '식사' },
  { id: 'culture', label: '전시·문화' },
  { id: 'park', label: '산책·공원' },
  { id: 'bar', label: '술' },
  { id: 'shop', label: '쇼핑' },
]

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function formatDistance(meters: number | null) {
  if (meters == null) return ''
  if (meters < 1000) return `${meters}m`
  return `${(meters / 1000).toFixed(1)}km`
}

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes}분`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('map')
  const [category, setCategory] = useState<CategoryId>('all')
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[]>([])
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mapReady, setMapReady] = useState(false)
  const [searchAreaDirty, setSearchAreaDirty] = useState(false)
  const [savedPlaces, setSavedPlaces] = useState<Place[]>(() =>
    readStorage('trippiece:saved-places', []),
  )
  const [routeStops, setRouteStops] = useState<Place[]>(() =>
    readStorage('trippiece:route-stops', []),
  )
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(() =>
    readStorage('trippiece:route-info', null),
  )
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>(() =>
    readStorage('trippiece:saved-routes', []),
  )
  const [routeLoading, setRouteLoading] = useState(false)

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const markersLayerRef = useRef<any>(null)
  const routeLayerRef = useRef<any>(null)
  const initialSearchDoneRef = useRef(false)

  useEffect(() => {
    localStorage.setItem('trippiece:saved-places', JSON.stringify(savedPlaces))
  }, [savedPlaces])

  useEffect(() => {
    localStorage.setItem('trippiece:route-stops', JSON.stringify(routeStops))
  }, [routeStops])

  useEffect(() => {
    localStorage.setItem('trippiece:route-info', JSON.stringify(routeInfo))
  }, [routeInfo])

  useEffect(() => {
    localStorage.setItem('trippiece:saved-routes', JSON.stringify(savedRoutes))
  }, [savedRoutes])

  const searchPlaces = async (
    searchQuery = query,
    searchCategory: CategoryId = category,
    fitResults = false,
  ) => {
    const map = mapRef.current
    if (!map) return

    const center = map.getCenter()
    setLoading(true)
    setError('')
    setSelectedPlace(null)

    try {
      const params = new URLSearchParams({
        q: searchQuery.trim(),
        category: searchQuery.trim() ? 'all' : searchCategory,
        x: String(center.lng),
        y: String(center.lat),
        radius: '3500',
      })

      const response = await fetch(`${API_BASE}/api/places?${params.toString()}`)
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.detail || result.error || '장소를 불러오지 못했습니다.')
      }

      const nextPlaces = result.places as Place[]
      setPlaces(nextPlaces)
      setSearchAreaDirty(false)

      if (fitResults && nextPlaces.length) {
        const L = window.L
        const bounds = L.latLngBounds(nextPlaces.map((place) => [place.lat, place.lng]))
        map.fitBounds(bounds.pad(0.18), { maxZoom: 16 })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '장소를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !window.L) return

    const L = window.L
    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 13)

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)

    L.control.zoom({ position: 'bottomright' }).addTo(map)
    markersLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    map.on('moveend', () => setSearchAreaDirty(true))
    setMapReady(true)

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          map.setView([position.coords.latitude, position.coords.longitude], 15)
        },
        () => undefined,
        { enableHighAccuracy: true, timeout: 5000 },
      )
    }

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!mapReady || initialSearchDoneRef.current) return
    initialSearchDoneRef.current = true
    void searchPlaces('', 'all')
  }, [mapReady])

  useEffect(() => {
    const map = mapRef.current
    const layer = markersLayerRef.current
    const L = window.L
    if (!map || !layer || !L) return

    layer.clearLayers()

    for (const place of places) {
      const saved = savedPlaces.some((item) => item.id === place.id)
      const icon = L.divIcon({
        className: 'place-marker-shell',
        html: `<div class="place-marker${saved ? ' saved' : ''}">${saved ? '♥' : '•'}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      })

      const marker = L.marker([place.lat, place.lng], {
        icon,
        title: place.name,
      }).addTo(layer)

      marker.on('click', () => setSelectedPlace(place))
    }
  }, [places, savedPlaces])

  useEffect(() => {
    const map = mapRef.current
    const L = window.L
    if (!map || !L) return

    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current)
      routeLayerRef.current = null
    }

    if (!routeInfo?.points.length) return

    const group = L.layerGroup().addTo(map)
    routeLayerRef.current = group

    const latLngs = routeInfo.points.map((point) => [point.lat, point.lng])
    L.polyline(latLngs, {
      color: '#111111',
      weight: 5,
      opacity: 0.9,
    }).addTo(group)

    routeStops.forEach((stop, index) => {
      const icon = L.divIcon({
        className: 'route-marker-shell',
        html: `<div class="route-marker">${index + 1}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      })
      L.marker([stop.lat, stop.lng], { icon, title: stop.name }).addTo(group)
    })

    if (activeTab === 'map') {
      map.fitBounds(L.latLngBounds(latLngs).pad(0.12), { maxZoom: 16 })
    }
  }, [routeInfo, routeStops, activeTab])

  useEffect(() => {
    if (activeTab !== 'map') return
    window.setTimeout(() => mapRef.current?.invalidateSize(), 0)
  }, [activeTab])

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    void searchPlaces(query, 'all', true)
  }

  const selectCategory = (nextCategory: CategoryId) => {
    setCategory(nextCategory)
    setQuery('')
    void searchPlaces('', nextCategory)
  }

  const moveToCurrentLocation = () => {
    if (!navigator.geolocation || !mapRef.current) return
    navigator.geolocation.getCurrentPosition((position) => {
      mapRef.current.setView([position.coords.latitude, position.coords.longitude], 16)
      setSearchAreaDirty(true)
    })
  }

  const isSaved = (place: Place) => savedPlaces.some((item) => item.id === place.id)
  const isInRoute = (place: Place) => routeStops.some((item) => item.id === place.id)

  const toggleSave = (place: Place) => {
    setSavedPlaces((current) =>
      current.some((item) => item.id === place.id)
        ? current.filter((item) => item.id !== place.id)
        : [...current, place],
    )
  }

  const toggleRouteStop = (place: Place) => {
    setRouteInfo(null)
    setRouteStops((current) => {
      if (current.some((item) => item.id === place.id)) {
        return current.filter((item) => item.id !== place.id)
      }
      if (current.length >= MAX_ROUTE_STOPS) {
        setError(`도보 동선은 현재 최대 ${MAX_ROUTE_STOPS}곳까지 지원합니다.`)
        return current
      }
      return [...current, place]
    })
  }

  const moveRouteStop = (index: number, direction: -1 | 1) => {
    setRouteInfo(null)
    setRouteStops((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const copy = [...current]
      ;[copy[index], copy[target]] = [copy[target], copy[index]]
      return copy
    })
  }

  const calculateRoute = async () => {
    if (routeStops.length < 2) return
    setRouteLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE}/api/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stops: routeStops.map(({ name, lat, lng }) => ({ name, lat, lng })),
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.detail || result.error || '동선을 계산하지 못했습니다.')
      }

      setRouteInfo(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '동선을 계산하지 못했습니다.')
    } finally {
      setRouteLoading(false)
    }
  }

  const saveCurrentRoute = () => {
    if (routeStops.length < 2) return
    const first = routeStops[0]
    const title = `${first.name} 외 ${routeStops.length - 1}곳`
    const route: SavedRoute = {
      id: `${Date.now()}`,
      title,
      stops: routeStops,
      routeInfo,
      createdAt: new Date().toISOString(),
    }
    setSavedRoutes((current) => [route, ...current])
  }

  const loadSavedRoute = (route: SavedRoute) => {
    setRouteStops(route.stops)
    setRouteInfo(route.routeInfo)
    setActiveTab('route')
  }

  const showRouteOnMap = () => {
    setActiveTab('map')
    setSelectedPlace(null)
  }

  return (
    <div className="app-shell">
      <section className={`map-screen ${activeTab === 'map' ? 'visible' : ''}`}>
        <div ref={mapContainerRef} className="map-canvas" />

        <header className="map-header">
          <div className="brand-row">
            <strong>trippiece</strong>
            <button className="location-button" onClick={moveToCurrentLocation} aria-label="현재 위치">
              ◎
            </button>
          </div>

          <form className="search-bar" onSubmit={handleSearch}>
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="장소, 동네, 음식 검색"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')}>
                ×
              </button>
            )}
          </form>

          <div className="category-row">
            {categories.map((item) => (
              <button
                key={item.id}
                className={category === item.id && !query ? 'active' : ''}
                onClick={() => selectCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        {searchAreaDirty && (
          <button className="search-area-button" onClick={() => void searchPlaces('', category)}>
            이 지역에서 검색
          </button>
        )}

        <div className="map-status">
          {loading ? '장소 찾는 중…' : `${places.length}곳`}
        </div>

        {routeInfo && (
          <button className="route-summary-pill" onClick={() => setActiveTab('route')}>
            동선 {routeStops.length}곳 · {formatDuration(routeInfo.totalTime)} · {formatDistance(routeInfo.totalDistance)}
          </button>
        )}

        {selectedPlace && (
          <article className="place-sheet">
            <button className="sheet-close" onClick={() => setSelectedPlace(null)}>×</button>
            <div className="place-sheet-main">
              <div className="place-meta">{selectedPlace.categoryGroup || selectedPlace.category.split(' > ').slice(-1)[0]}</div>
              <h2>{selectedPlace.name}</h2>
              <p>{selectedPlace.address}</p>
              {selectedPlace.distance != null && <small>현재 지도 중심에서 {formatDistance(selectedPlace.distance)}</small>}
            </div>

            <div className="place-sheet-actions">
              <button className={isSaved(selectedPlace) ? 'selected' : ''} onClick={() => toggleSave(selectedPlace)}>
                {isSaved(selectedPlace) ? '♥ 저장됨' : '♡ 저장'}
              </button>
              <button className={isInRoute(selectedPlace) ? 'selected' : ''} onClick={() => toggleRouteStop(selectedPlace)}>
                {isInRoute(selectedPlace) ? '동선에서 빼기' : '+ 동선에 추가'}
              </button>
            </div>

            <a className="kakao-link" href={selectedPlace.url} target="_blank" rel="noreferrer">
              카카오맵 상세 보기 ↗
            </a>
          </article>
        )}
      </section>

      {activeTab !== 'map' && (
        <main className="content-screen">
          <header className="content-header">
            <strong>trippiece</strong>
            <span>{activeTab === 'saved' ? '저장' : activeTab === 'route' ? '동선' : '내 코스'}</span>
          </header>

          {activeTab === 'saved' && (
            <section className="content-body">
              <div className="section-heading">
                <div>
                  <p>PLACE LIBRARY</p>
                  <h1>저장한 장소</h1>
                </div>
                <span>{savedPlaces.length}</span>
              </div>

              {savedPlaces.length === 0 ? (
                <div className="empty-state">
                  <h2>아직 저장한 장소가 없어요.</h2>
                  <p>지도에서 마음에 드는 장소를 ♥ 저장해두세요.</p>
                  <button onClick={() => setActiveTab('map')}>지도에서 찾기</button>
                </div>
              ) : (
                <div className="place-list">
                  {savedPlaces.map((place) => (
                    <article key={place.id} className="place-list-item">
                      <div>
                        <small>{place.categoryGroup || '장소'}</small>
                        <h3>{place.name}</h3>
                        <p>{place.address}</p>
                      </div>
                      <div className="list-actions">
                        <button className={isInRoute(place) ? 'active' : ''} onClick={() => toggleRouteStop(place)}>
                          {isInRoute(place) ? '동선 ✓' : '+ 동선'}
                        </button>
                        <button onClick={() => toggleSave(place)}>삭제</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === 'route' && (
            <section className="content-body">
              <div className="section-heading">
                <div>
                  <p>ROUTE BUILDER</p>
                  <h1>데이트 동선</h1>
                </div>
                <span>{routeStops.length}/{MAX_ROUTE_STOPS}</span>
              </div>

              {routeStops.length === 0 ? (
                <div className="empty-state">
                  <h2>장소를 먼저 담아주세요.</h2>
                  <p>지도나 저장 탭에서 장소를 동선에 추가할 수 있어요.</p>
                  <button onClick={() => setActiveTab('saved')}>저장한 장소 보기</button>
                </div>
              ) : (
                <>
                  <ol className="route-list">
                    {routeStops.map((place, index) => (
                      <li key={place.id}>
                        <div className="route-index">{index + 1}</div>
                        <div className="route-place">
                          <small>{place.categoryGroup || '장소'}</small>
                          <h3>{place.name}</h3>
                          {routeInfo?.legs[index] && (
                            <p>
                              다음 장소까지 {formatDistance(routeInfo.legs[index].distance)} · {formatDuration(routeInfo.legs[index].time)}
                            </p>
                          )}
                        </div>
                        <div className="reorder-buttons">
                          <button onClick={() => moveRouteStop(index, -1)} disabled={index === 0}>↑</button>
                          <button onClick={() => moveRouteStop(index, 1)} disabled={index === routeStops.length - 1}>↓</button>
                          <button onClick={() => toggleRouteStop(place)}>×</button>
                        </div>
                      </li>
                    ))}
                  </ol>

                  {routeStops.length >= 2 && (
                    <div className="route-actions">
                      <button className="primary-action" onClick={() => void calculateRoute()} disabled={routeLoading}>
                        {routeLoading ? '실제 도보 동선 계산 중…' : routeInfo ? '동선 다시 계산' : '실제 도보 동선 계산'}
                      </button>

                      {routeInfo && (
                        <div className="route-result">
                          <div>
                            <small>총 이동</small>
                            <strong>{formatDistance(routeInfo.totalDistance)}</strong>
                          </div>
                          <div>
                            <small>예상 도보</small>
                            <strong>{formatDuration(routeInfo.totalTime)}</strong>
                          </div>
                          <button onClick={showRouteOnMap}>지도에서 보기</button>
                          {routeInfo.landingUrl && (
                            <a href={routeInfo.landingUrl} target="_blank" rel="noreferrer">카카오맵 길찾기 ↗</a>
                          )}
                        </div>
                      )}

                      <button className="secondary-action" onClick={saveCurrentRoute}>
                        현재 동선 저장
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {activeTab === 'routes' && (
            <section className="content-body">
              <div className="section-heading">
                <div>
                  <p>MY ROUTES</p>
                  <h1>내 코스</h1>
                </div>
                <span>{savedRoutes.length}</span>
              </div>

              {savedRoutes.length === 0 ? (
                <div className="empty-state">
                  <h2>저장한 코스가 없어요.</h2>
                  <p>장소를 이어 동선을 만든 뒤 저장해보세요.</p>
                  <button onClick={() => setActiveTab('route')}>동선 만들기</button>
                </div>
              ) : (
                <div className="saved-route-list">
                  {savedRoutes.map((route) => (
                    <article key={route.id} className="saved-route-card">
                      <small>{new Date(route.createdAt).toLocaleDateString('ko-KR')}</small>
                      <h3>{route.title}</h3>
                      <p>{route.stops.map((stop) => stop.name).join(' → ')}</p>
                      {route.routeInfo && (
                        <div className="saved-route-meta">
                          {formatDistance(route.routeInfo.totalDistance)} · {formatDuration(route.routeInfo.totalTime)}
                        </div>
                      )}
                      <button onClick={() => loadSavedRoute(route)}>이 코스 열기</button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      )}

      {error && (
        <div className="toast" onClick={() => setError('')}>
          {error}
        </div>
      )}

      <nav className="bottom-nav">
        <button className={activeTab === 'map' ? 'active' : ''} onClick={() => setActiveTab('map')}>
          <span>⌖</span>지도
        </button>
        <button className={activeTab === 'saved' ? 'active' : ''} onClick={() => setActiveTab('saved')}>
          <span>♡</span>저장
          {savedPlaces.length > 0 && <b>{savedPlaces.length}</b>}
        </button>
        <button className={activeTab === 'route' ? 'active' : ''} onClick={() => setActiveTab('route')}>
          <span>↗</span>동선
          {routeStops.length > 0 && <b>{routeStops.length}</b>}
        </button>
        <button className={activeTab === 'routes' ? 'active' : ''} onClick={() => setActiveTab('routes')}>
          <span>☰</span>내 코스
        </button>
      </nav>
    </div>
  )
}

export default App
