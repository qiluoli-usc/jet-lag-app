const transitPacks = new Map();

function haversineMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function freezePack(pack) {
  return Object.freeze({
    ...pack,
    stops: Object.freeze(pack.stops.map((stop) => Object.freeze({ ...stop }))),
    routes: Object.freeze((pack.routes ?? []).map((route) => Object.freeze({ ...route }))),
    stopRouteIndex: Object.freeze({ ...(pack.stopRouteIndex ?? {}) }),
  });
}

function registerDefaultPacks() {
  if (transitPacks.size > 0) {
    return;
  }

  const shanghaiPack = freezePack({
    packId: "demo_shanghai_metro",
    sourceType: "CUSTOM",
    name: "Shanghai Demo Metro Pack",
    city: "Shanghai",
    version: "v1",
    stops: [
      { stopId: "sh_xujiahui", name: "Xujiahui", lat: 31.1947, lng: 121.4365 },
      { stopId: "sh_people_square", name: "People's Square", lat: 31.2336, lng: 121.4751 },
      { stopId: "sh_jingan_temple", name: "Jing'an Temple", lat: 31.2231, lng: 121.4455 },
      { stopId: "sh_lujiazui", name: "Lujiazui", lat: 31.2403, lng: 121.4998 },
      { stopId: "sh_hongqiao_railway", name: "Hongqiao Railway Station", lat: 31.1941, lng: 121.3270 },
    ],
    routes: [
      { routeId: "line_2", shortName: "L2", longName: "Metro Line 2" },
      { routeId: "line_9", shortName: "L9", longName: "Metro Line 9" },
      { routeId: "line_11", shortName: "L11", longName: "Metro Line 11" },
    ],
    stopRouteIndex: {
      sh_xujiahui: ["line_9", "line_11"],
      sh_people_square: ["line_2", "line_8", "line_1"],
      sh_jingan_temple: ["line_2", "line_7"],
      sh_lujiazui: ["line_2"],
      sh_hongqiao_railway: ["line_2"],
    },
  });

  transitPacks.set(shanghaiPack.packId, shanghaiPack);
}

registerDefaultPacks();

export function listTransitPacks() {
  return [...transitPacks.values()].map((pack) => ({
    packId: pack.packId,
    sourceType: pack.sourceType,
    name: pack.name,
    city: pack.city,
    version: pack.version,
    stopCount: pack.stops.length,
    routeCount: pack.routes.length,
  }));
}

export function getTransitPack(packId) {
  if (!packId) {
    return null;
  }
  return transitPacks.get(packId) ?? null;
}

export function getDefaultTransitPackId() {
  return listTransitPacks()[0]?.packId ?? null;
}

export function importTransitPack(rawPack) {
  const pack = {
    packId: String(rawPack?.packId ?? "").trim(),
    sourceType: String(rawPack?.sourceType ?? "CUSTOM").toUpperCase(),
    name: String(rawPack?.name ?? "Custom Transit Pack").trim(),
    city: String(rawPack?.city ?? "").trim(),
    version: String(rawPack?.version ?? "v1").trim(),
    stops: Array.isArray(rawPack?.stops) ? rawPack.stops : [],
    routes: Array.isArray(rawPack?.routes) ? rawPack.routes : [],
    stopRouteIndex: typeof rawPack?.stopRouteIndex === "object" && rawPack?.stopRouteIndex
      ? rawPack.stopRouteIndex
      : {},
  };

  if (!pack.packId) {
    throw new Error("packId is required");
  }
  if (pack.stops.length === 0) {
    throw new Error("Transit pack must contain at least one stop");
  }

  const normalizedStops = pack.stops.map((item) => ({
    stopId: String(item?.stopId ?? "").trim(),
    name: String(item?.name ?? "").trim(),
    lat: Number(item?.lat),
    lng: Number(item?.lng),
  }));
  for (const stop of normalizedStops) {
    if (!stop.stopId || !stop.name || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) {
      throw new Error("Each stop must include stopId, name, lat, lng");
    }
  }

  const normalizedRoutes = pack.routes.map((item) => ({
    routeId: String(item?.routeId ?? "").trim(),
    shortName: String(item?.shortName ?? "").trim(),
    longName: String(item?.longName ?? "").trim(),
  }));

  const frozen = freezePack({
    ...pack,
    stops: normalizedStops,
    routes: normalizedRoutes,
  });
  transitPacks.set(frozen.packId, frozen);
  return frozen;
}

export function findNearestTransitStop(packId, location, maxDistanceMeters = 1000) {
  const pack = getTransitPack(packId);
  if (!pack || !location) {
    return null;
  }
  let best = null;
  for (const stop of pack.stops) {
    const distanceMeters = haversineMeters(location, stop);
    if (!best || distanceMeters < best.distanceMeters) {
      best = {
        stopId: stop.stopId,
        name: stop.name,
        distanceMeters,
        lat: stop.lat,
        lng: stop.lng,
      };
    }
  }
  if (!best || best.distanceMeters > maxDistanceMeters) {
    return null;
  }
  return {
    ...best,
    distanceMeters: Number(best.distanceMeters.toFixed(2)),
  };
}

export function getTransitLinesForStop(packId, stopId) {
  const pack = getTransitPack(packId);
  if (!pack || !stopId) {
    return [];
  }
  return [...(pack.stopRouteIndex?.[stopId] ?? [])];
}

export function stopBelongsToRoute(packId, stopId, routeId) {
  return getTransitLinesForStop(packId, stopId).includes(routeId);
}
