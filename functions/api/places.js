const KAKAO_KEYWORD_ENDPOINT = 'https://dapi.kakao.com/v2/local/search/keyword.json'

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  })

const CATEGORY_QUERIES = {
  all: ['카페', '맛집', '전시', '공원', '와인바', '편집숍'],
  cafe: ['카페'],
  food: ['맛집'],
  culture: ['전시', '미술관'],
  park: ['공원', '산책'],
  bar: ['와인바', '칵테일바', '펍'],
  shop: ['편집숍', '소품샵'],
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

async function keywordSearch({ query, apiKey, x, y, radius, size = 15 }) {
  const url = new URL(KAKAO_KEYWORD_ENDPOINT)
  url.searchParams.set('query', query)
  url.searchParams.set('size', String(size))

  if (Number.isFinite(x) && Number.isFinite(y)) {
    url.searchParams.set('x', String(x))
    url.searchParams.set('y', String(y))
    url.searchParams.set('radius', String(radius))
    url.searchParams.set('sort', 'distance')
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `KakaoAK ${apiKey}`,
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Kakao API ${response.status}: ${body}`)
  }

  const data = await response.json()

  return (data.documents ?? []).map((place) => ({
    id: place.id,
    provider: 'kakao',
    providerPlaceId: place.id,
    name: place.place_name,
    category: place.category_name,
    categoryGroup: place.category_group_name,
    categoryGroupCode: place.category_group_code,
    address: place.road_address_name || place.address_name,
    lat: Number(place.y),
    lng: Number(place.x),
    phone: place.phone || '',
    url: place.place_url,
    distance: place.distance ? Number(place.distance) : null,
  }))
}

export async function onRequestGet(context) {
  try {
    const apiKey = context.env.KAKAO_REST_API_KEY

    if (!apiKey) {
      return json({ error: 'KAKAO_REST_API_KEY가 설정되지 않았습니다.' }, 500)
    }

    const requestUrl = new URL(context.request.url)
    const q = (requestUrl.searchParams.get('q') || '').trim()
    const category = requestUrl.searchParams.get('category') || 'all'
    const x = Number(requestUrl.searchParams.get('x'))
    const y = Number(requestUrl.searchParams.get('y'))
    const radius = clamp(Number(requestUrl.searchParams.get('radius')) || 2500, 500, 10000)

    const queries = q
      ? [q]
      : CATEGORY_QUERIES[category] || CATEGORY_QUERIES.all

    const resultSets = await Promise.all(
      queries.map((query) =>
        keywordSearch({ query, apiKey, x, y, radius, size: q ? 15 : 10 }),
      ),
    )

    const deduped = new Map()
    for (const places of resultSets) {
      for (const place of places) {
        if (!deduped.has(place.id)) deduped.set(place.id, place)
      }
    }

    const places = [...deduped.values()]
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
      .slice(0, 50)

    return json({
      source: 'kakao',
      query: q,
      category,
      center: Number.isFinite(x) && Number.isFinite(y) ? { lng: x, lat: y } : null,
      radius,
      places,
    })
  } catch (error) {
    console.error(error)
    return json(
      {
        error: '장소를 불러오지 못했습니다.',
        detail: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
}
