const KAKAO_ENDPOINT = 'https://dapi.kakao.com/v2/local/search/keyword.json'

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })

async function searchKakao(query, apiKey, size = 10) {
  const url = new URL(KAKAO_ENDPOINT)
  url.searchParams.set('query', query)
  url.searchParams.set('size', String(size))

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
    name: place.place_name,
    category: place.category_name,
    categoryGroup: place.category_group_name,
    address: place.road_address_name || place.address_name,
    lat: Number(place.y),
    lng: Number(place.x),
    phone: place.phone || '',
    url: place.place_url,
  }))
}

function haversineMeters(a, b) {
  const R = 6371000
  const toRad = (value) => (value * Math.PI) / 180

  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * R * Math.asin(Math.sqrt(h))
}

function walkingEstimateMinutes(meters) {
  // 4.5km/h + 교차로/신호 여유 15%
  return Math.max(3, Math.round((meters / 4500) * 60 * 1.15))
}

function isDuplicate(place, selected) {
  return selected.some(
    (item) =>
      item.id === place.id ||
      item.name === place.name ||
      haversineMeters(item, place) < 80,
  )
}

function choosePlace(candidates, selected, offset = 0) {
  if (!candidates.length) return null

  for (let i = 0; i < candidates.length; i += 1) {
    const place = candidates[(i + offset) % candidates.length]
    if (!isDuplicate(place, selected)) return place
  }

  return candidates[offset % candidates.length]
}

function buildCourse(index, pools) {
  const selected = []

  const activity = choosePlace(pools.activity, selected, index)
  if (activity) selected.push(activity)

  const cafe = choosePlace(pools.cafe, selected, index + 1)
  if (cafe) selected.push(cafe)

  const food = choosePlace(pools.food, selected, index + 2)
  if (food) selected.push(food)

  if (selected.length < 2) return null

  const segments = []
  let totalDistance = 0
  let totalWalkMinutes = 0

  for (let i = 0; i < selected.length - 1; i += 1) {
    const meters = Math.round(haversineMeters(selected[i], selected[i + 1]))
    const minutes = walkingEstimateMinutes(meters)

    totalDistance += meters
    totalWalkMinutes += minutes

    segments.push({
      fromPlaceId: selected[i].id,
      toPlaceId: selected[i + 1].id,
      meters,
      walkMinutes: minutes,
    })
  }

  const labels = ['균형 있게', '조금 새롭게', '천천히']
  const titles = [
    `${selected[0].name}에서 시작하는 코스`,
    `${selected[0].name}부터 이어가는 코스`,
    `${selected[0].name} 중심으로 걷는 코스`,
  ]

  return {
    id: `course-${index + 1}`,
    label: labels[index],
    title: titles[index],
    stops: selected,
    segments,
    totalDistance,
    totalWalkMinutes,
  }
}

export async function onRequestGet(context) {
  try {
    const apiKey = context.env.KAKAO_REST_API_KEY

    if (!apiKey) {
      return json(
        {
          error: 'KAKAO_REST_API_KEY가 Cloudflare에 설정되지 않았습니다.',
        },
        500,
      )
    }

    const requestUrl = new URL(context.request.url)
    const area = (requestUrl.searchParams.get('area') || '').trim()
    const vibe = (requestUrl.searchParams.get('vibe') || 'balanced').trim()

    if (!area) {
      return json({ error: 'area가 필요합니다.' }, 400)
    }

    const activityKeyword =
      vibe === 'nature'
        ? `${area} 공원 산책`
        : vibe === 'culture'
          ? `${area} 전시 미술관`
          : `${area} 전시 소품샵`

    const [activity, cafe, food] = await Promise.all([
      searchKakao(activityKeyword, apiKey, 15),
      searchKakao(`${area} 카페`, apiKey, 15),
      searchKakao(`${area} 맛집`, apiKey, 15),
    ])

    const pools = { activity, cafe, food }

    const courses = [0, 1, 2]
      .map((index) => buildCourse(index, pools))
      .filter(Boolean)

    return json({
      area,
      source: 'kakao',
      generatedAt: new Date().toISOString(),
      counts: {
        activity: activity.length,
        cafe: cafe.length,
        food: food.length,
      },
      courses,
    })
  } catch (error) {
    console.error(error)
    return json(
      {
        error: '실제 장소를 불러오지 못했습니다.',
        detail: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
}
