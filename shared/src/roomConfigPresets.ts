export interface PresetPoint {
  lat: number;
  lng: number;
}

export interface RoomRegionPreset {
  id: string;
  label: string;
  city: string;
  district: string;
  summary: string;
  boundary: readonly PresetPoint[];
  hidingArea: readonly PresetPoint[];
}

export interface HideDurationOption {
  seconds: number;
  label: string;
}

function freezePoints(points: PresetPoint[]) {
  return Object.freeze(points.map((point) => Object.freeze({ ...point })));
}

function preset(
  id: string,
  label: string,
  city: string,
  district: string,
  summary: string,
  boundary: PresetPoint[],
  hidingArea: PresetPoint[],
): RoomRegionPreset {
  return Object.freeze({
    id,
    label,
    city,
    district,
    summary,
    boundary: freezePoints(boundary),
    hidingArea: freezePoints(hidingArea),
  });
}

export const ROOM_REGION_PRESETS = Object.freeze([
  preset(
    "sh_jingan_core",
    "Jing'an Core",
    "Shanghai",
    "Jing'an District",
    "Temple, commercial blocks, and dense metro transfer area.",
    [
      { lat: 31.2388, lng: 121.4306 },
      { lat: 31.2388, lng: 121.4608 },
      { lat: 31.2104, lng: 121.4608 },
      { lat: 31.2104, lng: 121.4306 },
    ],
    [
      { lat: 31.2316, lng: 121.4386 },
      { lat: 31.2316, lng: 121.4536 },
      { lat: 31.2162, lng: 121.4536 },
      { lat: 31.2162, lng: 121.4386 },
    ],
  ),
  preset(
    "sh_huangpu_center",
    "Huangpu Center",
    "Shanghai",
    "Huangpu District",
    "People's Square, Nanjing Road, and river-adjacent downtown grid.",
    [
      { lat: 31.2434, lng: 121.4542 },
      { lat: 31.2434, lng: 121.4928 },
      { lat: 31.2196, lng: 121.4928 },
      { lat: 31.2196, lng: 121.4542 },
    ],
    [
      { lat: 31.2384, lng: 121.4664 },
      { lat: 31.2384, lng: 121.4844 },
      { lat: 31.2264, lng: 121.4844 },
      { lat: 31.2264, lng: 121.4664 },
    ],
  ),
  preset(
    "sh_xuhui_xujiahui",
    "Xujiahui",
    "Shanghai",
    "Xuhui District",
    "Park, shopping cluster, and dense multi-line station area.",
    [
      { lat: 31.2088, lng: 121.4204 },
      { lat: 31.2088, lng: 121.4548 },
      { lat: 31.1804, lng: 121.4548 },
      { lat: 31.1804, lng: 121.4204 },
    ],
    [
      { lat: 31.2016, lng: 121.4298 },
      { lat: 31.2016, lng: 121.4448 },
      { lat: 31.1888, lng: 121.4448 },
      { lat: 31.1888, lng: 121.4298 },
    ],
  ),
  preset(
    "sh_lujiazui",
    "Lujiazui",
    "Shanghai",
    "Pudong New Area",
    "Skyscraper district with river edge and line 2 station coverage.",
    [
      { lat: 31.2528, lng: 121.4864 },
      { lat: 31.2528, lng: 121.5208 },
      { lat: 31.2268, lng: 121.5208 },
      { lat: 31.2268, lng: 121.4864 },
    ],
    [
      { lat: 31.2464, lng: 121.4946 },
      { lat: 31.2464, lng: 121.5098 },
      { lat: 31.2342, lng: 121.5098 },
      { lat: 31.2342, lng: 121.4946 },
    ],
  ),
]);

export const HIDE_DURATION_OPTIONS = Object.freeze<HideDurationOption[]>([
  Object.freeze({ seconds: 15 * 60, label: "15 min" }),
  Object.freeze({ seconds: 30 * 60, label: "30 min" }),
  Object.freeze({ seconds: 45 * 60, label: "45 min" }),
  Object.freeze({ seconds: 60 * 60, label: "60 min" }),
  Object.freeze({ seconds: 90 * 60, label: "90 min" }),
  Object.freeze({ seconds: 120 * 60, label: "120 min" }),
]);

export function findRoomRegionPreset(id: string | null | undefined): RoomRegionPreset | null {
  const normalized = String(id ?? "").trim();
  if (!normalized) {
    return null;
  }
  return ROOM_REGION_PRESETS.find((item) => item.id === normalized) ?? null;
}

export function polygonGeoJsonFromPreset(points: readonly PresetPoint[]) {
  if (!Array.isArray(points) || points.length < 3) {
    return null;
  }
  const closed = [...points, points[0]];
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        closed.map((point) => [
          Number(point.lng.toFixed(6)),
          Number(point.lat.toFixed(6)),
        ]),
      ],
    },
    properties: {},
  };
}
