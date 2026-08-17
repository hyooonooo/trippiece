const KAKAO_WALK_ENDPOINT = 'https://dapi.kakao.com/v2/routing/walk'

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  })

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  })
}

export async function onRequestPost(context) {
  try {
    const apiKey = context.env.KAKAO_REST_API_KEY

    if (!apiKey) {
      return json({ error: 'KAKAO_REST_API_KEY가 설정되지 않았습니다.' }, 500)
    }

    const body = await context.request.json()
    const stops = Array.isArray(body?.stops) ? body.stops : []

    if (stops.length < 2) {
      return json({ error: '동선을 계산하려면 장소가 2개 이상 필요합니다.' }, 400)
    }

    if (stops.length > 7) {
      return json({ error: '현재 도보 동선은 최대 7개 장소까지 지원합니다.' }, 400)
    }

    const normalized = stops.map((stop) => ({
      name: String(stop.name || '장소'),
      lat: Number(stop.lat),
      lng: Number(stop.lng),
    }))

    if (normalized.some((stop) => !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng))) {
      return json({ error: '장소 좌표가 올바르지 않습니다.' }, 400)
    }

    const start = normalized[0]
    const end = normalized[normalized.length - 1]
    const vias = normalized.slice(1, -1)

    const url = new URL(KAKAO_WALK_ENDPOINT)
    url.searchParams.set('start_x', String(start.lng))
    url.searchParams.set('start_y', String(start.lat))
    url.searchParams.set('end_x', String(end.lng))
    url.searchParams.set('end_y', String(end.lat))
    url.searchParams.set('s_name', start.name)
    url.searchParams.set('e_name', end.name)
    url.searchParams.set('route_mode', 'SHORTEST')

    if (vias.length) {
      url.searchParams.set('via_x', vias.map((stop) => stop.lng).join(','))
      url.searchParams.set('via_y', vias.map((stop) => stop.lat).join(','))
      url.searchParams.set('v_name', vias.map((stop) => stop.name).join(','))
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `KakaoAK ${apiKey}`,
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Kakao Routing API ${response.status}: ${text}`)
    }

    const data = await response.json()

    if (data.status !== 'OK' || !data.route) {
      return json(
        {
          error: '도보 동선을 찾지 못했습니다.',
          detail: data.status || 'UNKNOWN',
        },
        422,
      )
    }

    const points = []
    for (const leg of data.route.legs ?? []) {
      for (const step of leg.steps ?? []) {
        for (const point of step.path?.points ?? []) {
          const [lng, lat] = point
          points.push({ lat, lng })
        }
      }
    }

    return json({
      source: 'kakao',
      totalDistance: data.route.properties?.totalDistance ?? 0,
      totalTime: data.route.properties?.totalTime ?? 0,
      landingUrl: data.route.properties?.landingUrl ?? '',
      legs: (data.route.legs ?? []).map((leg) => ({
        distance: leg.properties?.distance ?? 0,
        time: leg.properties?.time ?? 0,
      })),
      points,
    })
  } catch (error) {
    console.error(error)
    return json(
      {
        error: '도보 동선을 계산하지 못했습니다.',
        detail: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
}
