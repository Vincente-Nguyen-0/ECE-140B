"""In-memory GPS tracker + geofences + reverse geocode (FastAPI router).

This keeps the map/alerts features simple for local demos:
- ESP/simulator POSTs GPS to /api/gps
- Browser polls /api/devices
- Safe-zones stored in app/geofences.json
"""

from __future__ import annotations

import json
import math
import os
import time
from datetime import datetime
from typing import Any, Optional

import requests
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

router = APIRouter()

DEFAULT_ID = "ESP-01"
DEFAULT_NAME = "Device 1"

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_UA = "E-Shady-GPS-Tracker/1.0 (ece140; local dev)"
PHOTON_REVERSE_URL = "https://photon.komoot.io/reverse"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GEOFENCES_FILE = os.path.join(BASE_DIR, "geofences.json")

ONLINE_MAX_AGE_SEC = 15

devices: dict[str, dict[str, Any]] = {}
geofences: dict[str, dict[str, Any]] = {}

_geocode_cache: dict[str, str] = {}  # key -> HTML string with <br>
_last_geocode_at = 0.0


def normalize_device_id(device_id: str) -> str:
    return (device_id or "").strip().upper()


def load_geofences() -> None:
    global geofences
    if os.path.isfile(GEOFENCES_FILE):
        try:
            with open(GEOFENCES_FILE, encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                geofences = {
                    normalize_device_id(k): {**v, "device_id": normalize_device_id(v.get("device_id", k))}
                    for k, v in raw.items()
                }
            else:
                geofences = {}
        except (json.JSONDecodeError, OSError) as exc:
            print(f"[geofence] load error: {exc}")
            geofences = {}


def save_geofences() -> None:
    try:
        with open(GEOFENCES_FILE, "w", encoding="utf-8") as f:
            json.dump(geofences, f, indent=2)
    except OSError as exc:
        print(f"[geofence] save error: {exc}")


load_geofences()


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_000
    to_rad = math.radians
    d_lat = to_rad(lat2 - lat1)
    d_lng = to_rad(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _short_display_name(display: str, max_parts: int = 3) -> str:
    parts = [p.strip() for p in display.split(",") if p.strip()]
    return ", ".join(parts[:max_parts]) if parts else display


def format_address(address: dict) -> str:
    line1 = " ".join(p for p in (address.get("house_number"), address.get("road")) if p)
    if not line1:
        for key in ("amenity", "building", "leisure", "pedestrian", "footway", "university", "retail"):
            if address.get(key):
                line1 = str(address[key])
                break
    city = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("suburb")
        or address.get("neighbourhood")
        or ""
    )
    line2 = ", ".join(p for p in (city, address.get("state"), address.get("postcode")) if p)
    parts = [p for p in (line1, line2, address.get("country")) if p]
    return "<br>".join(parts) if parts else ""


def format_address_plain(address: dict) -> str:
    html = format_address(address)
    return html.replace("<br>", ", ") if html else ""


def reverse_geocode_photon(lat: float, lng: float) -> Optional[str]:
    """Fallback when Nominatim is rate-limited."""
    try:
        res = requests.get(
            PHOTON_REVERSE_URL,
            params={"lat": lat, "lon": lng},
            headers={"User-Agent": NOMINATIM_UA},
            timeout=6,
        )
        if not res.ok:
            return None
        features = res.json().get("features") or []
        if not features:
            return None
        props = features[0].get("properties") or {}
        parts: list[str] = []
        for key in ("name", "street", "city", "state", "country"):
            val = props.get(key)
            if val and str(val) not in parts:
                parts.append(str(val))
        return ", ".join(parts[:4]) if parts else None
    except requests.RequestException as exc:
        print(f"[geocode] photon error: {exc}")
        return None


def reverse_geocode_plain(lat: float, lng: float) -> Optional[str]:
    global _last_geocode_at
    if lat == 0 and lng == 0:
        return None

    key = f"{lat:.4f},{lng:.4f}"
    cached = _geocode_cache.get(key)
    if cached:
        return cached.replace("<br>", ", ")

    # Fast path first (important for map popups with many devices).
    photon = reverse_geocode_photon(lat, lng)
    if photon:
        _geocode_cache[key] = photon.replace(", ", "<br>")
        return photon

    elapsed = time.time() - _last_geocode_at
    if elapsed < 1.1:
        time.sleep(1.1 - elapsed)

    try:
        res = requests.get(
            NOMINATIM_URL,
            params={"lat": lat, "lon": lng, "format": "json", "zoom": 18, "addressdetails": 1},
            headers={"User-Agent": NOMINATIM_UA},
            timeout=8,
        )
        _last_geocode_at = time.time()
        if res.status_code == 429:
            print("[geocode] rate limited by Nominatim — using cache/coords only")
            return None
        if res.ok:
            payload = res.json()
            address = payload.get("address") or {}
            addr_html = format_address(address)
            addr_plain = format_address_plain(address)
            if not addr_plain:
                display = payload.get("display_name") or ""
                if display:
                    addr_plain = _short_display_name(display)
                    addr_html = addr_plain.replace(", ", "<br>")
            if addr_html:
                _geocode_cache[key] = addr_html
            return addr_plain or None
    except requests.RequestException as exc:
        print(f"[geocode] error: {exc}")

    return None


def device_is_online(device: dict[str, Any]) -> bool:
    received_at = device.get("received_at")
    if not received_at:
        return False
    try:
        seen = datetime.fromisoformat(received_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    age_sec = (datetime.now(seen.tzinfo) - seen).total_seconds()
    fix_valid = device.get("fix_valid") in (True, "true", "True", 1)
    return age_sec <= ONLINE_MAX_AGE_SEC and fix_valid


def upsert_gps_device(
    device_id: str,
    *,
    mac: Optional[str] = None,
    name: Optional[str] = None,
    latitude: float = 0.0,
    longitude: float = 0.0,
    altitude_m: float = 0.0,
    speed_kmph: float = 0.0,
    course_deg: float = 0.0,
    satellites: int = 0,
    fix_valid: bool = False,
    datetime_str: Optional[str] = None,
) -> dict[str, Any]:
    device_id = normalize_device_id(device_id)
    device_name = name or devices.get(device_id, {}).get("name", DEFAULT_NAME)
    prev = devices.get(device_id) or {}
    # IMPORTANT: Don't reverse-geocode during high-frequency GPS ingestion.
    # It can block the server (especially with many simulated devices).
    # Address resolution is done on-demand via /api/geocode (and cached).
    lat_f = float(latitude)
    lng_f = float(longitude)
    address_label = prev.get("address_label")

    record = {
        "id": device_id,
        "mac": mac or device_id,
        "name": device_name,
        "latitude": lat_f,
        "longitude": lng_f,
        "altitude_m": float(altitude_m),
        "speed_kmph": float(speed_kmph),
        "course_deg": float(course_deg),
        "satellites": int(satellites),
        "fix_valid": bool(fix_valid),
        "datetime": datetime_str,
        "received_at": datetime.utcnow().isoformat() + "Z",
        "address_label": address_label,
    }
    devices[device_id] = record
    return record


class GeofencePut(BaseModel):
    device_id: str
    lat: float
    lng: float
    radius_m: float = Field(default=200, ge=25, le=50_000)
    enabled: bool = True


@router.post("/api/gps")
async def receive_gps(request: Request) -> JSONResponse:
    data = await request.json()
    if not data:
        raise HTTPException(status_code=400, detail="No JSON body")

    mac = data.get("mac") or data.get("id")
    device_id = normalize_device_id(mac if mac else DEFAULT_ID)
    device_name = data.get("name", devices.get(device_id, {}).get("name", DEFAULT_NAME))

    record = upsert_gps_device(
        device_id,
        mac=mac or device_id,
        name=device_name,
        latitude=float(data.get("latitude", 0)),
        longitude=float(data.get("longitude", 0)),
        altitude_m=float(data.get("altitude_m", 0)),
        speed_kmph=float(data.get("speed_kmph", 0)),
        course_deg=float(data.get("course_deg", 0)),
        satellites=int(data.get("satellites", 0)),
        fix_valid=bool(data.get("fix_valid", False)),
        datetime_str=data.get("datetime"),
    )

    print(
        f"[GPS] mac={record['mac']}  lat={record['latitude']:.6f}  "
        f"lng={record['longitude']:.6f}  sats={record['satellites']}  fix={record['fix_valid']}"
    )
    return JSONResponse({"status": "ok"})


@router.get("/api/devices")
def send_devices() -> JSONResponse:
    return JSONResponse(list(devices.values()))


@router.get("/api/gps")
def send_gps_legacy() -> JSONResponse:
    if devices:
        return JSONResponse(list(devices.values())[0])
    return JSONResponse({"fix_valid": False, "received_at": None})


@router.get("/api/geofence/status")
def geofence_status(device_id: str, lat: float, lng: float) -> JSONResponse:
    fence = geofences.get(device_id)
    if not fence or not fence.get("enabled"):
        return JSONResponse({"inside": None})
    dist = haversine_meters(lat, lng, float(fence["lat"]), float(fence["lng"]))
    return JSONResponse({"inside": dist <= float(fence["radius_m"]), "distance_m": round(dist)})


@router.get("/api/geofences")
def get_geofences() -> JSONResponse:
    return JSONResponse(list(geofences.values()))


@router.put("/api/geofences")
def put_geofence(body: GeofencePut) -> JSONResponse:
    device_id = normalize_device_id(body.device_id)
    radius_m = max(25.0, min(float(body.radius_m), 50_000.0))
    geofences[device_id] = {
        "device_id": device_id,
        "lat": body.lat,
        "lng": body.lng,
        "radius_m": radius_m,
        "enabled": body.enabled,
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }
    save_geofences()
    return JSONResponse(geofences[device_id])


@router.delete("/api/geofences")
async def delete_geofence(request: Request) -> JSONResponse:
    data = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    device_id = normalize_device_id(data.get("device_id") or request.query_params.get("device_id") or "")
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id required")
    geofences.pop(device_id, None)
    save_geofences()
    return JSONResponse({"status": "ok"})


@router.get("/api/geocode")
def geocode(lat: float = Query(...), lon: float = Query(...)) -> JSONResponse:
    key = f"{lat:.4f},{lon:.4f}"
    if key in _geocode_cache:
        return JSONResponse({"address": _geocode_cache[key]})

    plain = reverse_geocode_plain(lat, lon)
    if plain:
        # Cache stores HTML with <br>, client expects HTML; derive from plain if needed.
        return JSONResponse({"address": _geocode_cache.get(key, plain.replace(", ", "<br>"))})

    return JSONResponse({"address": None})


def compute_zone_breaches() -> list[dict[str, Any]]:
    breaches: list[dict[str, Any]] = []
    for device_id, fence in geofences.items():
        if not fence.get("enabled"):
            continue
        device = devices.get(device_id) or devices.get(fence.get("device_id", ""))
        if not device or not device_is_online(device):
            continue

        lat = float(device.get("latitude", 0))
        lng = float(device.get("longitude", 0))
        if lat == 0 and lng == 0:
            continue

        zone_lat = float(fence["lat"])
        zone_lng = float(fence["lng"])
        radius_m = float(fence["radius_m"])
        distance_m = haversine_meters(lat, lng, zone_lat, zone_lng)
        if distance_m <= radius_m:
            continue

        breaches.append(
            {
                "device_id": device_id,
                "device_name": device.get("name", device_id),
                "latitude": lat,
                "longitude": lng,
                "distance_m": round(distance_m),
                "radius_m": round(radius_m),
                "zone_lat": zone_lat,
                "zone_lng": zone_lng,
                "received_at": device.get("received_at"),
                "message": (
                    f"Left the safe zone — {round(distance_m)} m from center "
                    f"(limit {round(radius_m)} m)"
                ),
            }
        )

    breaches.sort(key=lambda item: item["distance_m"], reverse=True)
    return breaches


@router.get("/api/alerts/zone")
def zone_breach_alerts() -> JSONResponse:
    breaches = compute_zone_breaches()
    zones_monitored = sum(1 for fence in geofences.values() if fence.get("enabled", True))
    devices_online = sum(1 for device in devices.values() if device_is_online(device))
    return JSONResponse(
        {
            "count": len(breaches),
            "alerts": breaches,
            "zones_monitored": zones_monitored,
            "has_zones": zones_monitored > 0,
            "devices_online": devices_online,
            "checked_at": datetime.utcnow().isoformat() + "Z",
        }
    )
