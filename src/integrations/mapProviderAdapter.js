import { getTransitLinesForStop } from "./transitPack.js";

export const MapProvider = Object.freeze({
  GOOGLE: "GOOGLE",
  MAPBOX: "MAPBOX",
  AMAP: "AMAP",
  CUSTOM: "CUSTOM",
});

const providers = new Set(Object.values(MapProvider));

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function distanceMeters(a, b) {
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

export function normalizeMapProvider(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (providers.has(normalized)) {
    return normalized;
  }
  return MapProvider.GOOGLE;
}

const PLACE_DB = [
  {
    placeId: "poi_jingan_temple",
    name: "Jing'an Temple",
    categories: ["landmark", "temple", "poi"],
    lat: 31.2231,
    lng: 121.4455,
    review_count: 21840,
    adminLevels: {
      level1: "Shanghai",
      level2: "Jing'an District",
      level3: "Jing'an Temple Subdistrict",
      level4: "Wanhangdu Road Community",
    },
  },
  {
    placeId: "poi_people_square",
    name: "People's Square",
    categories: ["landmark", "square", "poi"],
    lat: 31.2336,
    lng: 121.4751,
    review_count: 17201,
    adminLevels: {
      level1: "Shanghai",
      level2: "Huangpu District",
      level3: "People's Square Subdistrict",
      level4: "West Nanjing Road Community",
    },
  },
  {
    placeId: "poi_xujiahui_park",
    name: "Xujiahui Park",
    categories: ["park", "poi", "natural"],
    lat: 31.1944,
    lng: 121.4377,
    review_count: 3412,
    adminLevels: {
      level1: "Shanghai",
      level2: "Xuhui District",
      level3: "Xujiahui Subdistrict",
      level4: "Hengshan Road Community",
    },
  },
  {
    placeId: "poi_small_local_cafe",
    name: "Small Local Cafe",
    categories: ["cafe", "restaurant", "poi"],
    lat: 31.2317,
    lng: 121.4782,
    review_count: 3,
    adminLevels: {
      level1: "Shanghai",
      level2: "Huangpu District",
      level3: "Nanjing East Road Subdistrict",
      level4: "Fuzhou Road Community",
    },
  },
  {
    placeId: "poi_lujiazui_station",
    name: "Lujiazui Station",
    categories: ["transit_station", "poi"],
    lat: 31.2403,
    lng: 121.4998,
    review_count: 167,
    adminLevels: {
      level1: "Shanghai",
      level2: "Pudong New Area",
      level3: "Lujiazui Subdistrict",
      level4: "Century Avenue Community",
    },
  },
];

function clonePlace(place) {
  return {
    placeId: place.placeId,
    name: place.name,
    categories: [...place.categories],
    lat: place.lat,
    lng: place.lng,
    review_count: place.review_count,
    adminLevels: { ...place.adminLevels },
  };
}

function rankedPlaceSearch(query, center, radiusM) {
  const q = String(query ?? "").trim().toLowerCase();
  const r = Math.max(50, Number(radiusM ?? 5000));
  const c = {
    lat: Number(center?.lat),
    lng: Number(center?.lng),
  };
  const hasCenter = Number.isFinite(c.lat) && Number.isFinite(c.lng);

  const matched = [];
  for (const place of PLACE_DB) {
    if (q) {
      const haystack = `${place.name} ${place.categories.join(" ")}`.toLowerCase();
      if (!haystack.includes(q)) {
        continue;
      }
    }

    const d = hasCenter ? distanceMeters(c, place) : 0;
    if (hasCenter && d > r) {
      continue;
    }
    matched.push({
      ...clonePlace(place),
      distanceMeters: Number(d.toFixed(2)),
    });
  }

  matched.sort((a, b) => a.distanceMeters - b.distanceMeters || b.review_count - a.review_count);
  return matched;
}

function reverseAdminLookup(lat, lng) {
  const point = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return {
      level1: null,
      level2: null,
      level3: null,
      level4: null,
    };
  }
  let nearest = null;
  for (const place of PLACE_DB) {
    const d = distanceMeters(point, place);
    if (!nearest || d < nearest.distanceMeters) {
      nearest = { place, distanceMeters: d };
    }
  }
  return nearest ? { ...nearest.place.adminLevels } : {
    level1: null,
    level2: null,
    level3: null,
    level4: null,
  };
}

function buildAdapter(providerName) {
  const provider = normalizeMapProvider(providerName);
  return {
    provider,
    async searchPlaces(query, center, radiusM) {
      return rankedPlaceSearch(query, center, radiusM);
    },
    async getPlaceDetails(placeId) {
      const place = PLACE_DB.find((item) => item.placeId === placeId);
      if (!place) {
        return null;
      }
      return clonePlace(place);
    },
    async reverseGeocodeAdminLevels(lat, lng) {
      return reverseAdminLookup(lat, lng);
    },
    distanceMeters,
    async getTransitLineForTrip(tripContext) {
      const packId = String(tripContext?.transitPackId ?? "");
      const stopId = String(tripContext?.stopId ?? "");
      const lines = getTransitLinesForStop(packId, stopId);
      if (lines.length === 0) {
        return null;
      }
      return lines[0];
    },
  };
}

export function getMapProviderAdapter(providerName) {
  return buildAdapter(providerName);
}
