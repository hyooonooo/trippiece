import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

declare global {
  interface Window {
    L: any
  }
}

type Tab = 'map' | 'saved' | 'routes'
type RouteBuilderStep = 'pick' | 'arrange'
type CategoryId = 'all' | 'cafe' | 'food' | 'culture' | 'park' | 'bar' | 'shop'
type SavedCategoryId = Exclude<CategoryId, 'all'> | 'other'

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

const savedCategoryOrder: { id: SavedCategoryId; label: string }[] = [
  { id: 'cafe', label: '카페' },
  { id: 'food', label: '식사' },
  { id: 'culture', label: '전시·문화' },
  { id: 'park', label: '산책·공원' },
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

function savedCategoryFor(place: Place): SavedCategoryId {
  const text = `${place.category} ${place.categoryGroup} ${place.name}`.toLowerCase()

  if (/와인|칵테일|펍|주점|술집|바\b/.test(text)) return 'bar'
  if (place.categoryGroupCode === 'CE7' || /카페|커피|디저트|베이커리/.test(text)) return 'cafe'
  if (place.categoryGroupCode === 'FD6' || /음식점|맛집|식당|레스토랑/.test(text)) return 'food'
  if (/공원|산책|숲|정원|자연|수목원/.test(text)) return 'park'
  if (place.categoryGroupCode === 'CT1' || /전시|미술관|박물관|갤러리|공연|문화/.test(text)) return 'culture'
  if (/쇼핑|편집숍|편집샵|소품|백화점|시장|스토어/.test(text)) return 'shop'
  if (place.categoryGroupCode === 'AT4') return 'culture'
  return 'other'
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
  const [routeBuilderOpen, setRouteBuilderOpen] = useState(false)
  const [routeBuilderStep, setRouteBuilderStep] = useState<RouteBuilderStep>('pick')
  const [routeDraftIds, setRouteDraftIds] = useState<string[]>([])

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const markersLayerRef = useRef<any>(null)
  const routeLayerRef = useRef<any>(null)
  const initialSearchDoneRef = useRef(false)

  const groupedSavedPlaces = useMemo(
    () =>
      savedCategoryOrder
        .map((group) => ({
          ...group,
          places: savedPlaces.filter((place) => savedCategoryFor(place) === group.id),
        }))
        .filter((group) => group.places.length > 0),
    [savedPlaces],
  )

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

  const toggleSave = (place: Place) => {
    const removing = savedPlaces.some((item) => item.id === place.id)

    setSavedPlaces((current) =>
      removing
        ? current.filter((item) => item.id !== place.id)
        : [...current, place],
    )

    if (removing) {
      setRouteDraftIds((current) => current.filter((id) => id !== place.id))
      setRouteStops((current) => current.filter((item) => item.id !== place.id))
      setRouteInfo(null)
    }
  }

  const openNewRouteBuilder = () => {
    if (savedPlaces.length < 2) {
      setError('동선을 만들려면 장소를 2곳 이상 저장해주세요.')
      return
    }

    setRouteDraftIds([])
    setRouteStops([])
    setRouteInfo(null)
    setRouteBuilderStep('pick')
    setRouteBuilderOpen(true)
  }

  const toggleRouteDraft = (placeId: string) => {
    setRouteDraftIds((current) => {
      if (current.includes(placeId)) return current.filter((id) => id !== placeId)
      if (current.length >= MAX_ROUTE_STOPS) {
        setError(`동선에는 최대 ${MAX_ROUTE_STOPS}곳까지 담을 수 있어요.`)
        return current
      }
      return [...current, placeId]
    })
  }

  const confirmRouteDraft = () => {
    if (routeDraftIds.length < 2) {
      setError('장소를 2곳 이상 골라주세요.')
      return
    }

    const nextStops = routeDraftIds
      .map((id) => savedPlaces.find((place) => place.id === id))
      .filter((place): place is Place => Boolean(place))

    setRouteStops(nextStops)
    setRouteInfo(null)
    setRouteBuilderStep('arrange')
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

  const removeRouteStop = (placeId: string) => {
    setRouteInfo(null)
    setRouteStops((current) => current.filter((place) => place.id !== placeId))
  }

  const backToRoutePicker = () => {
    setRouteDraftIds(routeStops.map((place) => place.id))
    setRouteBuilderStep('pick')
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
    setRouteBuilderOpen(false)
    setActiveTab('routes')
  }

  const loadSavedRoute = (route: SavedRoute) => {
    setRouteStops(route.stops)
    setRouteInfo(route.routeInfo)
    setRouteDraftIds(route.stops.map((place) => place.id))
    setRouteBuilderStep('arrange')
    setRouteBuilderOpen(true)
  }

  const showRouteOnMap = () => {
    setRouteBuilderOpen(false)
    setActiveTab('map')
    setSelectedPlace(null)
  }

  const openCurrentRouteBuilder = () => {
    setRouteDraftIds(routeStops.map((place) => place.id))
    setRouteBuilderStep('arrange')
    setRouteBuilderOpen(true)
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
          <button className="route-summary-pill" onClick={openCurrentRouteBuilder}>
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

            <button className={`save-place-button ${isSaved(selectedPlace) ? 'selected' : ''}`} onClick={() => toggleSave(selectedPlace)}>
              {isSaved(selectedPlace) ? '♥ 저장됨' : '♡ 저장하기'}
            </button>

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
            <span>{activeTab === 'saved' ? '저장' : '내 코스'}</span>
          </header>

          {activeTab === 'saved' && (
            <section className={`content-body ${savedPlaces.length >= 2 ? 'with-sticky-cta' : ''}`}>
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
                  <p>지도에서 마음에 드는 장소를 저장하면 카테고리별로 자동 정리돼요.</p>
                  <button onClick={() => setActiveTab('map')}>지도에서 찾기</button>
                </div>
              ) : (
                <div className="saved-category-list">
                  {groupedSavedPlaces.map((group) => (
                    <section key={group.id} className="saved-category-section">
                      <header>
                        <h2>{group.label}</h2>
                        <span>{group.places.length}</span>
                      </header>

                      <div className="place-list">
                        {group.places.map((place) => (
                          <article key={place.id} className="place-list-item">
                            <div>
                              <small>{place.categoryGroup || group.label}</small>
                              <h3>{place.name}</h3>
                              <p>{place.address}</p>
                            </div>
                            <button className="remove-save-button" onClick={() => toggleSave(place)} aria-label={`${place.name} 저장 해제`}>
                              ♥
                            </button>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
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
                  <p>저장한 장소에서 원하는 곳을 골라 동선을 만들어보세요.</p>
                  <button onClick={() => setActiveTab('saved')}>저장한 장소 보기</button>
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
                      <button onClick={() => loadSavedRoute(route)}>코스 열기</button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      )}

      {activeTab === 'saved' && savedPlaces.length >= 2 && !routeBuilderOpen && (
        <div className="saved-sticky-cta">
          <button onClick={openNewRouteBuilder}>동선 만들기</button>
        </div>
      )}

      {routeBuilderOpen && (
        <div className="route-builder-layer">
          <section className="route-builder-sheet">
            <header className="route-builder-header">
              <button onClick={() => setRouteBuilderOpen(false)} aria-label="닫기">×</button>
              <div>
                <small>{routeBuilderStep === 'pick' ? 'STEP 1' : 'STEP 2'}</small>
                <h1>{routeBuilderStep === 'pick' ? '어디를 갈까?' : '어떤 순서로 갈까?'}</h1>
                <p>
                  {routeBuilderStep === 'pick'
                    ? '저장한 장소에서 이번 데이트에 갈 곳을 골라주세요.'
                    : '방문 순서를 정한 뒤 실제 도보 동선을 계산할 수 있어요.'}
                </p>
              </div>
            </header>

            {routeBuilderStep === 'pick' ? (
              <div className="route-picker-body">
                {groupedSavedPlaces.map((group) => (
                  <section key={group.id} className="route-picker-group">
                    <header>
                      <h2>{group.label}</h2>
                      <span>{group.places.length}</span>
                    </header>
                    <div>
                      {group.places.map((place) => {
                        const selected = routeDraftIds.includes(place.id)
                        const selectedOrder = selected ? routeDraftIds.indexOf(place.id) + 1 : null
                        return (
                          <button
                            key={place.id}
                            className={`route-picker-row ${selected ? 'selected' : ''}`}
                            onClick={() => toggleRouteDraft(place.id)}
                          >
                            <span className="picker-check">{selectedOrder ?? ''}</span>
                            <span className="picker-copy">
                              <strong>{place.name}</strong>
                              <small>{place.address}</small>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="route-arrange-body">
                <button className="back-to-picker" onClick={backToRoutePicker}>← 장소 다시 고르기</button>

                <ol className="route-list">
                  {routeStops.map((place, index) => (
                    <li key={place.id}>
                      <div className="route-index">{index + 1}</div>
                      <div className="route-place">
                        <small>{savedCategoryOrder.find((group) => group.id === savedCategoryFor(place))?.label || '장소'}</small>
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
                        <button onClick={() => removeRouteStop(place.id)}>×</button>
                      </div>
                    </li>
                  ))}
                </ol>

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
              </div>
            )}

            <footer className="route-builder-footer">
              {routeBuilderStep === 'pick' ? (
                <>
                  <span>{routeDraftIds.length}곳 선택</span>
                  <button className="primary-action" onClick={confirmRouteDraft} disabled={routeDraftIds.length < 2}>
                    순서 정하기
                  </button>
                </>
              ) : (
                <>
                  <button className="primary-action" onClick={() => void calculateRoute()} disabled={routeLoading || routeStops.length < 2}>
                    {routeLoading ? '도보 동선 계산 중…' : routeInfo ? '동선 다시 계산' : '실제 도보 동선 계산'}
                  </button>
                  {routeInfo && (
                    <button className="secondary-action" onClick={saveCurrentRoute}>현재 동선 저장</button>
                  )}
                </>
              )}
            </footer>
          </section>
        </div>
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
        <button className={activeTab === 'routes' ? 'active' : ''} onClick={() => setActiveTab('routes')}>
          <span>☰</span>내 코스
        </button>
      </nav>
    </div>
  )
}

export default App
