import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

declare global {
  interface Window {
    L: any
  }
}

type Tab = 'map' | 'bookmarks' | 'courses'
type BookmarkMode = 'browse' | 'select'
type CategoryId = 'all' | 'cafe' | 'food' | 'culture' | 'park' | 'bar' | 'shop'
type BookmarkCategoryId = 'food' | 'cafe' | 'culture' | 'park' | 'bar' | 'shop' | 'other'
type RouteOrigin = 'bookmarks' | 'courses'

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

const mapCategories: { id: CategoryId; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'cafe', label: '카페' },
  { id: 'food', label: '식사' },
  { id: 'culture', label: '전시·문화' },
  { id: 'park', label: '산책·공원' },
  { id: 'bar', label: '술' },
  { id: 'shop', label: '쇼핑' },
]

const bookmarkCategories: { id: BookmarkCategoryId; label: string }[] = [
  { id: 'food', label: '먹기' },
  { id: 'cafe', label: '카페' },
  { id: 'culture', label: '볼거리' },
  { id: 'park', label: '산책' },
  { id: 'bar', label: '술' },
  { id: 'shop', label: '쇼핑' },
  { id: 'other', label: '기타' },
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
  if (meters < 1000) return `${Math.round(meters)}m`
  return `${(meters / 1000).toFixed(1)}km`
}

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes}분`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`
}

function bookmarkCategoryFor(place: Place): BookmarkCategoryId {
  const text = `${place.category} ${place.categoryGroup} ${place.name}`.toLowerCase()

  if (/와인|칵테일|펍|주점|술집|포차|bar\b/.test(text)) return 'bar'
  if (place.categoryGroupCode === 'CE7' || /카페|커피|디저트|베이커리|제과/.test(text)) return 'cafe'
  if (place.categoryGroupCode === 'FD6' || /음식점|맛집|식당|레스토랑|한식|양식|일식|중식/.test(text)) return 'food'
  if (/공원|산책|숲|정원|수목원|둘레길|한강/.test(text)) return 'park'
  if (place.categoryGroupCode === 'CT1' || place.categoryGroupCode === 'AT4' || /전시|미술관|박물관|갤러리|공연|문화|극장|영화관|체험/.test(text)) return 'culture'
  if (/쇼핑|편집숍|편집샵|소품|백화점|시장|스토어|상점|문구/.test(text)) return 'shop'
  return 'other'
}

function routeTitle(stops: Place[]) {
  if (stops.length === 0) return '새 동선'
  if (stops.length === 1) return stops[0].name
  return `${stops[0].name} → ${stops[stops.length - 1].name}`
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
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>(() =>
    readStorage('trippiece:saved-routes', []),
  )

  const [bookmarkMode, setBookmarkMode] = useState<BookmarkMode>('browse')
  const [selectedBookmarkIds, setSelectedBookmarkIds] = useState<string[]>([])

  const [routeEditorOpen, setRouteEditorOpen] = useState(false)
  const [routeOrigin, setRouteOrigin] = useState<RouteOrigin>('bookmarks')
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null)
  const [routeStops, setRouteStops] = useState<Place[]>([])
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const markersLayerRef = useRef<any>(null)
  const initialSearchDoneRef = useRef(false)

  const routeMapContainerRef = useRef<HTMLDivElement | null>(null)
  const routeMapRef = useRef<any>(null)
  const routeMapLayerRef = useRef<any>(null)
  const routeRequestSeqRef = useRef(0)

  const groupedBookmarks = useMemo(
    () =>
      bookmarkCategories
        .map((group) => ({
          ...group,
          places: savedPlaces.filter((place) => bookmarkCategoryFor(place) === group.id),
        }))
        .filter((group) => group.places.length > 0),
    [savedPlaces],
  )

  useEffect(() => {
    localStorage.setItem('trippiece:saved-places', JSON.stringify(savedPlaces))
  }, [savedPlaces])

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
    const layer = markersLayerRef.current
    const L = window.L
    if (!layer || !L) return

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
    if (activeTab !== 'map' || routeEditorOpen) return
    window.setTimeout(() => mapRef.current?.invalidateSize(), 0)
  }, [activeTab, routeEditorOpen])

  useEffect(() => {
    if (!routeEditorOpen || !routeMapContainerRef.current || routeMapRef.current || !window.L) return

    const L = window.L
    const first = routeStops[0]
    const map = L.map(routeMapContainerRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView(
      first ? [first.lat, first.lng] : [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
      14,
    )

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)

    routeMapRef.current = map
    routeMapLayerRef.current = L.layerGroup().addTo(map)
    window.setTimeout(() => map.invalidateSize(), 0)

    return () => {
      map.remove()
      routeMapRef.current = null
      routeMapLayerRef.current = null
    }
  }, [routeEditorOpen])

  useEffect(() => {
    if (!routeEditorOpen) return

    const map = routeMapRef.current
    const layer = routeMapLayerRef.current
    const L = window.L
    if (!map || !layer || !L || routeStops.length === 0) return

    layer.clearLayers()

    if (routeInfo?.points.length) {
      const latLngs = routeInfo.points.map((point) => [point.lat, point.lng])
      L.polyline(latLngs, {
        color: '#191919',
        weight: 5,
        opacity: 0.88,
      }).addTo(layer)
    }

    routeStops.forEach((stop, index) => {
      const icon = L.divIcon({
        className: 'route-marker-shell',
        html: `<div class="route-marker">${index + 1}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      })
      L.marker([stop.lat, stop.lng], { icon, title: stop.name }).addTo(layer)
    })

    const bounds = L.latLngBounds(routeStops.map((stop) => [stop.lat, stop.lng]))
    map.fitBounds(bounds.pad(0.22), { maxZoom: 16 })
  }, [routeEditorOpen, routeStops, routeInfo])

  const calculateRoute = async (stops: Place[]) => {
    if (stops.length < 2) {
      setRouteInfo(null)
      setRouteLoading(false)
      return
    }

    const seq = ++routeRequestSeqRef.current
    setRouteLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE}/api/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stops: stops.map(({ name, lat, lng }) => ({ name, lat, lng })),
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.detail || result.error || '동선을 계산하지 못했습니다.')
      }

      if (seq === routeRequestSeqRef.current) {
        setRouteInfo(result)
      }
    } catch (err) {
      if (seq === routeRequestSeqRef.current) {
        setRouteInfo(null)
        setError(err instanceof Error ? err.message : '동선을 계산하지 못했습니다.')
      }
    } finally {
      if (seq === routeRequestSeqRef.current) {
        setRouteLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!routeEditorOpen) return

    if (routeStops.length < 2) {
      routeRequestSeqRef.current += 1
      setRouteInfo(null)
      setRouteLoading(false)
      return
    }

    const timer = window.setTimeout(() => {
      void calculateRoute(routeStops)
    }, 250)

    return () => window.clearTimeout(timer)
  }, [routeEditorOpen, routeStops])

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    void searchPlaces(query, 'all', true)
  }

  const selectMapCategory = (nextCategory: CategoryId) => {
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

  const toggleSave = (place: Place) => {
    setSavedPlaces((current) =>
      current.some((item) => item.id === place.id)
        ? current.filter((item) => item.id !== place.id)
        : [...current, place],
    )
    setSelectedBookmarkIds((current) => current.filter((id) => id !== place.id))
  }

  const startRouteSelection = () => {
    if (savedPlaces.length < 2) {
      setError('동선을 만들려면 장소를 2곳 이상 북마크해주세요.')
      return
    }

    setSelectedBookmarkIds([])
    setBookmarkMode('select')
  }

  const cancelRouteSelection = () => {
    setSelectedBookmarkIds([])
    setBookmarkMode('browse')
  }

  const toggleBookmarkSelection = (placeId: string) => {
    setSelectedBookmarkIds((current) => {
      if (current.includes(placeId)) return current.filter((id) => id !== placeId)
      if (current.length >= MAX_ROUTE_STOPS) {
        setError(`한 동선에는 최대 ${MAX_ROUTE_STOPS}곳까지 담을 수 있어요.`)
        return current
      }
      return [...current, placeId]
    })
  }

  const createRouteFromSelection = () => {
    if (selectedBookmarkIds.length < 2) {
      setError('장소를 2곳 이상 골라주세요.')
      return
    }

    const stops = selectedBookmarkIds
      .map((id) => savedPlaces.find((place) => place.id === id))
      .filter((place): place is Place => Boolean(place))

    setRouteStops(stops)
    setRouteInfo(null)
    setEditingRouteId(null)
    setRouteOrigin('bookmarks')
    setBookmarkMode('browse')
    setRouteEditorOpen(true)
  }

  const moveRouteStop = (index: number, direction: -1 | 1) => {
    setRouteStops((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const copy = [...current]
      ;[copy[index], copy[target]] = [copy[target], copy[index]]
      return copy
    })
  }

  const removeRouteStop = (placeId: string) => {
    setRouteStops((current) => current.filter((place) => place.id !== placeId))
  }

  const exitRouteEditor = () => {
    routeRequestSeqRef.current += 1
    setRouteEditorOpen(false)
    setRouteLoading(false)

    if (routeOrigin === 'bookmarks') {
      setActiveTab('bookmarks')
      setBookmarkMode('select')
      setSelectedBookmarkIds(routeStops.map((stop) => stop.id))
    } else {
      setActiveTab('courses')
      setBookmarkMode('browse')
    }
  }

  const saveRoute = () => {
    if (routeStops.length < 2) {
      setError('동선에는 장소가 2곳 이상 필요해요.')
      return
    }

    const now = new Date().toISOString()
    const id = editingRouteId ?? `${Date.now()}`
    const nextRoute: SavedRoute = {
      id,
      title: routeTitle(routeStops),
      stops: routeStops,
      routeInfo,
      createdAt: now,
    }

    setSavedRoutes((current) => {
      const withoutCurrent = current.filter((route) => route.id !== id)
      return [nextRoute, ...withoutCurrent]
    })

    routeRequestSeqRef.current += 1
    setEditingRouteId(id)
    setRouteEditorOpen(false)
    setRouteLoading(false)
    setBookmarkMode('browse')
    setSelectedBookmarkIds([])
    setActiveTab('courses')
  }

  const openSavedRoute = (route: SavedRoute) => {
    setRouteStops(route.stops)
    setRouteInfo(route.routeInfo)
    setEditingRouteId(route.id)
    setRouteOrigin('courses')
    setRouteEditorOpen(true)
  }

  const deleteSavedRoute = (routeId: string) => {
    setSavedRoutes((current) => current.filter((route) => route.id !== routeId))
  }

  return (
    <div className="app-shell">
      <section className={`map-screen ${activeTab === 'map' && !routeEditorOpen ? 'visible' : ''}`}>
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
              <button type="button" onClick={() => setQuery('')} aria-label="검색어 지우기">
                ×
              </button>
            )}
          </form>

          <div className="category-row">
            {mapCategories.map((item) => (
              <button
                key={item.id}
                className={category === item.id && !query ? 'active' : ''}
                onClick={() => selectMapCategory(item.id)}
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

        {selectedPlace && (
          <article className="place-sheet">
            <button className="sheet-close" onClick={() => setSelectedPlace(null)} aria-label="닫기">
              ×
            </button>
            <div className="place-sheet-main">
              <div className="place-meta">
                {selectedPlace.categoryGroup || selectedPlace.category.split(' > ').slice(-1)[0] || '장소'}
              </div>
              <h2>{selectedPlace.name}</h2>
              <p>{selectedPlace.address}</p>
              {selectedPlace.distance != null && (
                <small>현재 지도 중심에서 {formatDistance(selectedPlace.distance)}</small>
              )}
            </div>

            <button
              className={`bookmark-main-button ${isSaved(selectedPlace) ? 'saved' : ''}`}
              onClick={() => toggleSave(selectedPlace)}
            >
              {isSaved(selectedPlace) ? '♥ 북마크됨' : '♡ 북마크'}
            </button>

            <a className="kakao-link" href={selectedPlace.url} target="_blank" rel="noreferrer">
              카카오맵에서 보기 ↗
            </a>
          </article>
        )}
      </section>

      {!routeEditorOpen && activeTab !== 'map' && (
        <main className="content-screen">
          {activeTab === 'bookmarks' && (
            <>
              <header className="simple-header">
                {bookmarkMode === 'select' ? (
                  <>
                    <button onClick={cancelRouteSelection}>취소</button>
                    <strong>장소 선택</strong>
                    <span>{selectedBookmarkIds.length}/{MAX_ROUTE_STOPS}</span>
                  </>
                ) : (
                  <>
                    <strong>북마크</strong>
                    <span>{savedPlaces.length}</span>
                  </>
                )}
              </header>

              <section className={`bookmark-page ${bookmarkMode === 'select' ? 'selecting' : ''}`}>
                {savedPlaces.length === 0 ? (
                  <div className="empty-state">
                    <h2>아직 북마크가 없어요.</h2>
                    <p>지도에서 마음에 드는 장소를 저장해두세요.</p>
                    <button onClick={() => setActiveTab('map')}>지도에서 찾기</button>
                  </div>
                ) : (
                  <div className="bookmark-groups">
                    {groupedBookmarks.map((group) => (
                      <section className="bookmark-group" key={group.id}>
                        <div className="bookmark-group-title">
                          <h2>{group.label}</h2>
                          <span>{group.places.length}</span>
                        </div>

                        <div className="bookmark-list">
                          {group.places.map((place) => {
                            const selected = selectedBookmarkIds.includes(place.id)
                            return (
                              <article
                                className={`bookmark-card ${selected ? 'selected' : ''}`}
                                key={place.id}
                                onClick={() => bookmarkMode === 'select' && toggleBookmarkSelection(place.id)}
                              >
                                {bookmarkMode === 'select' && (
                                  <button
                                    className="select-circle"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      toggleBookmarkSelection(place.id)
                                    }}
                                    aria-label={`${place.name} 선택`}
                                  >
                                    {selected ? '✓' : ''}
                                  </button>
                                )}

                                <div className="bookmark-card-copy">
                                  <small>{place.categoryGroup || group.label}</small>
                                  <h3>{place.name}</h3>
                                  <p>{place.address}</p>
                                </div>

                                {bookmarkMode === 'browse' && (
                                  <button
                                    className="heart-button"
                                    onClick={() => toggleSave(place)}
                                    aria-label={`${place.name} 북마크 해제`}
                                  >
                                    ♥
                                  </button>
                                )}
                              </article>
                            )
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </section>

              {savedPlaces.length > 0 && bookmarkMode === 'browse' && (
                <div className="sticky-cta">
                  <button onClick={startRouteSelection} disabled={savedPlaces.length < 2}>
                    동선 만들기
                  </button>
                </div>
              )}

              {bookmarkMode === 'select' && (
                <div className="selection-cta">
                  <div>
                    <strong>{selectedBookmarkIds.length}곳 선택</strong>
                    <span>카테고리를 보며 원하는 장소를 골라주세요.</span>
                  </div>
                  <button onClick={createRouteFromSelection} disabled={selectedBookmarkIds.length < 2}>
                    다음
                  </button>
                </div>
              )}
            </>
          )}

          {activeTab === 'courses' && (
            <>
              <header className="simple-header">
                <strong>내 코스</strong>
                <span>{savedRoutes.length}</span>
              </header>

              <section className="courses-page">
                {savedRoutes.length === 0 ? (
                  <div className="empty-state">
                    <h2>아직 만든 코스가 없어요.</h2>
                    <p>북마크한 장소를 골라 첫 동선을 만들어보세요.</p>
                    <button onClick={() => setActiveTab('bookmarks')}>북마크 보기</button>
                  </div>
                ) : (
                  <div className="course-list">
                    {savedRoutes.map((route) => (
                      <article className="course-card" key={route.id}>
                        <small>{new Date(route.createdAt).toLocaleDateString('ko-KR')}</small>
                        <h2>{route.title}</h2>
                        <p>{route.stops.map((stop) => stop.name).join(' → ')}</p>
                        {route.routeInfo && (
                          <div className="course-meta">
                            {formatDistance(route.routeInfo.totalDistance)} · 도보 {formatDuration(route.routeInfo.totalTime)}
                          </div>
                        )}
                        <div className="course-card-actions">
                          <button className="open-course" onClick={() => openSavedRoute(route)}>
                            코스 열기
                          </button>
                          <button className="delete-course" onClick={() => deleteSavedRoute(route.id)}>
                            삭제
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      )}

      {routeEditorOpen && (
        <main className="route-editor">
          <header className="route-editor-header">
            <button onClick={exitRouteEditor}>
              ← {routeOrigin === 'bookmarks' ? '장소 선택' : '내 코스'}
            </button>
            <strong>동선 만들기</strong>
            <span>{routeStops.length}곳</span>
          </header>

          <div className="route-map-wrap">
            <div ref={routeMapContainerRef} className="route-map" />
            <div className="route-map-status">
              {routeLoading
                ? '동선 계산 중…'
                : routeInfo
                  ? `${formatDistance(routeInfo.totalDistance)} · 도보 ${formatDuration(routeInfo.totalTime)}`
                  : routeStops.length < 2
                    ? '장소를 2곳 이상 남겨주세요.'
                    : '동선을 불러오지 못했습니다.'}
            </div>
          </div>

          <section className="route-editor-body">
            <ol className="route-stop-list">
              {routeStops.map((place, index) => (
                <li key={place.id}>
                  <div className="route-order">{index + 1}</div>
                  <div className="route-stop-copy">
                    <small>{bookmarkCategories.find((group) => group.id === bookmarkCategoryFor(place))?.label}</small>
                    <h3>{place.name}</h3>
                    {routeInfo?.legs[index] && index < routeStops.length - 1 && (
                      <p>
                        다음 장소까지 {formatDistance(routeInfo.legs[index].distance)} · {formatDuration(routeInfo.legs[index].time)}
                      </p>
                    )}
                  </div>
                  <div className="route-stop-actions">
                    <button onClick={() => moveRouteStop(index, -1)} disabled={index === 0} aria-label="위로 이동">
                      ↑
                    </button>
                    <button
                      onClick={() => moveRouteStop(index, 1)}
                      disabled={index === routeStops.length - 1}
                      aria-label="아래로 이동"
                    >
                      ↓
                    </button>
                    <button onClick={() => removeRouteStop(place.id)} aria-label="장소 제거">
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div className="route-save-bar">
            <div>
              <small>총 이동</small>
              <strong>
                {routeLoading
                  ? '계산 중'
                  : routeInfo
                    ? `${formatDistance(routeInfo.totalDistance)} · ${formatDuration(routeInfo.totalTime)}`
                    : '—'}
              </strong>
            </div>
            <button onClick={saveRoute} disabled={routeStops.length < 2 || routeLoading}>
              동선 저장
            </button>
          </div>
        </main>
      )}

      {error && (
        <button className="toast" onClick={() => setError('')}>
          {error}
        </button>
      )}

      {!routeEditorOpen && (
        <nav className="bottom-nav">
          <button className={activeTab === 'map' ? 'active' : ''} onClick={() => setActiveTab('map')}>
            <span>⌖</span>
            지도
          </button>
          <button
            className={activeTab === 'bookmarks' ? 'active' : ''}
            onClick={() => {
              setBookmarkMode('browse')
              setActiveTab('bookmarks')
            }}
          >
            <span>♡</span>
            북마크
            {savedPlaces.length > 0 && <b>{savedPlaces.length}</b>}
          </button>
          <button className={activeTab === 'courses' ? 'active' : ''} onClick={() => setActiveTab('courses')}>
            <span>☰</span>
            코스
          </button>
        </nav>
      )}
    </div>
  )
}

export default App
