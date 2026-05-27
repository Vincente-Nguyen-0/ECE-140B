<<<<<<< Updated upstream
const API_BASE = '/api';
const POLL_INTERVAL = 5000;
const DEFAULT_CENTER = [32.7157, -117.1611];
const DEFAULT_ZOOM = 13;

let map;
let marker;
let polyline;
let trackingPath = false;
let pathCoords = [];
let lastLat = null;
let lastLng = null;

function getAuthHeaders() {
  const token = localStorage.getItem('eshady_token');
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setStatus(state, text) {
  const dot = document.getElementById('status-dot');
  const status = document.getElementById('status-text');
  if (dot) dot.className = `status-dot ${state}`;
  if (status) status.textContent = text;
}

function setBadge(state, text) {
  const dot = document.querySelector('.badge-dot');
  const label = document.getElementById('badge-label');
  if (dot) dot.className = `badge-dot ${state}`;
  if (label) label.textContent = text;
}

function initMap() {
  map = L.map('map', {
    center: DEFAULT_CENTER,
    zoom: 10,
    zoomControl: true,
    attributionControl: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(map);

  marker = L.marker(DEFAULT_CENTER).addTo(map);
  marker.bindPopup('Waiting for station location...');

  polyline = L.polyline([], {
    color: 'rgba(245,166,35,0.8)',
    weight: 3,
    dashArray: '6 4',
  }).addTo(map);
}

async function fetchStations() {
  const response = await fetch(`${API_BASE}/stations`, { headers: getAuthHeaders() });
  if (response.status === 401) {
    localStorage.removeItem('eshady_token');
    window.location.href = '/login';
    return [];
  }
  if (!response.ok) {
    throw new Error('Unable to load station locations.');
  }
  return response.json();
}

function chooseStation(stations) {
  return stations.find((station) => Number(station.latitude) || Number(station.longitude)) || stations[0];
}

function updateLocation(station) {
  if (!station) {
    setStatus('error', 'No paired stations yet');
    setBadge('', 'Offline');
    setText('val-lat', '--');
    setText('val-lng', '--');
    setText('last-update-time', 'never');
    return;
  }

  const lat = Number(station.latitude || 0);
  const lng = Number(station.longitude || 0);
  const isLive = Boolean(station.online);
  const state = isLive ? 'live' : 'error';
  const label = isLive ? 'Live' : 'Offline';
  const location = [lat, lng];

  setStatus(state, `${station.name} ${isLive ? 'is reporting location' : 'is offline'}`);
  setBadge(state, label);
  setText('val-lat', `${lat.toFixed(6)} ${lat >= 0 ? 'N' : 'S'}`);
  setText('val-lng', `${lng.toFixed(6)} ${lng >= 0 ? 'E' : 'W'}`);
  setText('last-update-time', station.last_seen ? new Date(station.last_seen).toLocaleTimeString() : 'unknown');

  marker.setLatLng(location);
  marker.setPopupContent(`
    <strong>${escapeHTML(station.name)}</strong><br>
    ${escapeHTML(station.location || 'No location label')}<br>
    Battery: ${station.battery_pct}%<br>
    Output: ${station.charge_w}W
  `);

  if (lastLat === null || lastLng === null) {
    map.setView(location, DEFAULT_ZOOM);
  }

  if (trackingPath) {
    pathCoords.push(location);
    polyline.setLatLngs(pathCoords);
  }

  lastLat = lat;
  lastLng = lng;
}

async function refreshMap() {
  try {
    const stations = await fetchStations();
    updateLocation(chooseStation(stations || []));
  } catch (error) {
    console.warn(error);
    setStatus('error', 'Cannot reach server');
    setBadge('', 'Offline');
  }
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  refreshMap();
  setInterval(refreshMap, POLL_INTERVAL);

  const centerButton = document.getElementById('btn-center');
  if (centerButton) {
    centerButton.addEventListener('click', () => {
      if (lastLat !== null && lastLng !== null) {
        map.flyTo([lastLat, lastLng], DEFAULT_ZOOM, { duration: 1.2 });
      }
    });
  }

  const trackButton = document.getElementById('btn-track');
  if (trackButton) {
    trackButton.addEventListener('click', () => {
      trackingPath = !trackingPath;
      trackButton.textContent = trackingPath ? 'Stop Tracking' : 'Track Path';
      if (trackingPath) {
        pathCoords = lastLat !== null && lastLng !== null ? [[lastLat, lastLng]] : [];
        polyline.setLatLngs(pathCoords);
      }
    });
  }
});
=======
const API_URL = "/api/devices";
const POLL_INTERVAL = 3000;
const DEFAULT_ZOOM = 16;
const GEOCODE_MIN_INTERVAL_MS = 120;
const GEOCODE_TIMEOUT_MS = 4500;
const GEOCODE_POPUP_WAIT_MS = 3500;
const MAP_FOCUS_KEY = "eshady_map_focus";

const DEVICE_COLORS = [
  "#F5A623",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ef4444",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#ec4899",
  "#14b8a6",
  "#8b5cf6",
  "#f59e0b",
  "#10b981",
  "#6366f1",
  "#e11d48",
  "#0ea5e9",
];

let map;
let allDevices = [];
let selectedDeviceId = null;
let geofencePlaceMode = false;

// device_id -> { marker, color }
const deviceState = {};

// device_id -> { device_id, lat, lng, radius_m, enabled }
const geofences = {};
// device_id -> true | false | null
const geofenceInside = {};
// device_id -> DOM element
const activeAlerts = new Map();

// Popup/Focus deep-link snapshot (so it doesn't drift while markers update)
let snapshot = null;
let snapshotMarker = null;

// Reverse geocode cache
const geocodeResultCache = new Map(); // key -> html string
let geocodeChain = Promise.resolve();

const elStatusDot = document.getElementById("status-dot");
const elStatusLabel = document.getElementById("status-label");
const elDeviceList = document.getElementById("device-list");
const elDeviceCount = document.getElementById("device-count");
const elSearch = document.getElementById("device-search");

const elSelectedBlock = document.getElementById("selected-device-block");
const elSelectedName = document.getElementById("selected-device-name");
const elSelectedId = document.getElementById("selected-device-id");

const elGeofencePanel = document.getElementById("geofence-panel");
const elGeofenceControls = document.getElementById("geofence-controls");
const elGeofenceHint = document.getElementById("geofence-hint");
const elGeofenceStatusPill = document.getElementById("geofence-status-pill");
const elGeofenceRadius = document.getElementById("geofence-radius");
const elGeofenceRadiusVal = document.getElementById("geofence-radius-val");
const elGeofenceStatus = document.getElementById("geofence-status");

const btnFit = document.getElementById("btn-fit");
const btnPlaceZone = document.getElementById("btn-place-zone");
const btnClearZone = document.getElementById("btn-clear-zone");
const btnCenterDevice = document.getElementById("btn-center-device");
const btnPlaceZoneDevice = document.getElementById("btn-place-zone-device");
const elLastUpdateTime = document.getElementById("last-update-time");

const elAlertStack = document.getElementById("alert-stack");

function normalizeDeviceId(id) {
  return String(id || "").trim().toUpperCase();
}

function escapeHTML(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function geoCacheKey(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function formatCoordsFallback(lat, lng) {
  const latStr =
    Math.abs(lat).toFixed(5) + "° " + (lat >= 0 ? "N" : "S");
  const lngStr =
    Math.abs(lng).toFixed(5) + "° " + (lng >= 0 ? "E" : "W");
  return `${latStr}, ${lngStr}`;
}

function normalizeAddressText(value) {
  if (!value) return null;
  return String(value)
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,+/g, ",")
    .replace(/^,\s*|\s*,$/g, "")
    .trim();
}

function queueReverseGeocode(lat, lng) {
  const key = geoCacheKey(lat, lng);
  if (geocodeResultCache.has(key)) {
    const hit = geocodeResultCache.get(key);
    return Promise.resolve(hit || null);
  }

  const run = geocodeChain.then(() => fetchGeocode(lat, lng));
  geocodeChain = run
    .then((addr) => {
      geocodeResultCache.set(key, addr || "");
      return addr;
    })
    .then(() => new Promise((r) => setTimeout(r, GEOCODE_MIN_INTERVAL_MS)))
    .catch(() => {
      geocodeResultCache.set(key, "");
      return new Promise((r) => setTimeout(r, GEOCODE_MIN_INTERVAL_MS));
    });
  return run;
}

async function fetchGeocode(lat, lng) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/geocode?lat=${lat}&lon=${lng}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json();
    return normalizeAddressText(json?.address || null);
  } catch (err) {
    if (err.name !== "AbortError") console.warn("Geocode error", lat, lng, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function deviceAddressLabel(device) {
  const label = device?.address_label;
  return normalizeAddressText(label);
}

function buildPopup(device, lat, lng, addressHtml, loading = false) {
  const latStr = Math.abs(lat).toFixed(5) + "° " + (lat >= 0 ? "N" : "S");
  const lngStr = Math.abs(lng).toFixed(5) + "° " + (lng >= 0 ? "E" : "W");
  const coords = `${latStr}, ${lngStr}`;
  const addrClass = loading ? "popup-address loading" : "popup-address";
  let addrBody = addressHtml;
  if (!addrBody && !loading) {
    addrBody = escapeHTML(deviceAddressLabel(device) || "Location unavailable");
  } else if (!addrBody) {
    addrBody = "Looking up address…";
  }
  return `
    <div class="popup-device-id">${escapeHTML(device.name || device.id)}</div>
    <div class="${addrClass}">${addrBody}</div>
    <div class="popup-coords">${coords}</div>
  `;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isOnline(device) {
  if (!device?.received_at) return false;
  const receivedAt = new Date(device.received_at);
  const ageMs = Date.now() - receivedAt.getTime();
  const fixValid = device.fix_valid === true || device.fix_valid === "true" || device.fix_valid === 1;
  return ageMs <= 15000 && fixValid;
}

function showAlert(deviceId, title, message) {
  if (!elAlertStack) return;
  if (activeAlerts.has(deviceId)) {
    const existing = activeAlerts.get(deviceId);
    existing.querySelector(".alert-title").textContent = title;
    existing.querySelector(".alert-msg").textContent = message;
    return;
  }

  const el = document.createElement("div");
  el.className = "alert-banner";
  el.innerHTML = `
    <span class="alert-icon" aria-hidden="true">⚠</span>
    <div class="alert-body">
      <span class="alert-title">${escapeHTML(title)}</span>
      <span class="alert-msg">${escapeHTML(message)}</span>
    </div>
    <button type="button" class="alert-dismiss" aria-label="Dismiss">✕</button>
  `;
  el.querySelector(".alert-dismiss").addEventListener("click", () => clearAlert(deviceId));
  elAlertStack.prepend(el);
  activeAlerts.set(deviceId, el);
}

function clearAlert(deviceId) {
  const el = activeAlerts.get(deviceId);
  if (el) {
    el.remove();
    activeAlerts.delete(deviceId);
  }
}

function devicePosition(device) {
  const lat = parseFloat(device?.latitude);
  const lng = parseFloat(device?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

function computeInsideZone(deviceId, lat, lng) {
  const fence = geofences[deviceId];
  if (!fence?.enabled) return null;
  const dist = haversineMeters(lat, lng, Number(fence.lat), Number(fence.lng));
  return dist <= Number(fence.radius_m);
}

function zoneInsideFor(deviceId) {
  if (geofenceInside[deviceId] === true || geofenceInside[deviceId] === false) {
    return geofenceInside[deviceId];
  }
  const device = allDevices.find((d) => d.id === deviceId);
  const pos = device && devicePosition(device);
  if (!pos) return null;
  return computeInsideZone(deviceId, pos.lat, pos.lng);
}

function zoneBadgeFor(deviceId) {
  const fence = geofences[deviceId];
  if (!fence?.enabled) return '<span class="device-badge zone-none">No zone</span>';
  const inside = zoneInsideFor(deviceId);
  if (inside === true) return '<span class="device-badge zone-inside">In safe zone</span>';
  if (inside === false) {
    return '<span class="device-badge zone-outside">Outside safe zone</span>';
  }
  return '<span class="device-badge zone-none">Zone active</span>';
}

function updateHeaderStatus(onlineCount, deviceCount) {
  const hasDevices = deviceCount > 0;
  const live = onlineCount > 0 && hasDevices;
  if (elStatusDot) elStatusDot.className = "indicator-dot " + (live ? "live" : "offline");
  if (elStatusLabel) {
    if (!hasDevices) elStatusLabel.textContent = "Waiting for devices";
    else if (live) elStatusLabel.textContent = `${onlineCount} device${onlineCount === 1 ? "" : "s"} live`;
    else elStatusLabel.textContent = `${deviceCount} detected`;
  }
}

function cachedAddressHtml(lat, lng) {
  const key = geoCacheKey(lat, lng);
  if (!geocodeResultCache.has(key)) return undefined;
  const hit = geocodeResultCache.get(key);
  return hit ? escapeHTML(hit) : null;
}

function resolveAddressWithTimeout(lat, lng, ms = GEOCODE_POPUP_WAIT_MS) {
  return Promise.race([
    resolveAddress(lat, lng),
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function updateMarkerPopup(state, device, lat, lng, { fetchAddress = false } = {}) {
  const key = geoCacheKey(lat, lng);
  const label = deviceAddressLabel(device);
  if (label) {
    state.marker.setPopupContent(buildPopup(device, lat, lng, escapeHTML(label), false));
    state._popupGeoKey = key;
    return;
  }

  const cached = cachedAddressHtml(lat, lng);
  if (cached !== undefined) {
    state.marker.setPopupContent(buildPopup(device, lat, lng, cached, false));
    state._popupGeoKey = key;
    return;
  }

  const popupOpen = Boolean(state.marker.isPopupOpen?.());
  if (!fetchAddress && !popupOpen) {
    state._popupGeoKey = key;
    state.marker.setPopupContent(buildPopup(device, lat, lng, null, false));
    return;
  }

  if (state._geocodePendingKey === key) return;
  state._geocodePendingKey = key;
  state._popupGeoKey = key;
  state.marker.setPopupContent(buildPopup(device, lat, lng, null, true));

  resolveAddressWithTimeout(lat, lng).then((addr) => {
    if (state._geocodePendingKey === key) state._geocodePendingKey = null;
    const ll = state.marker.getLatLng();
    if (geoCacheKey(ll.lat, ll.lng) !== key) return;
    const body = addr ? escapeHTML(addr) : null;
    state.marker.setPopupContent(buildPopup(device, lat, lng, body, false));
  });
}

function drawGeofenceCircle(deviceId) {
  const fence = geofences[deviceId];
  const state = deviceState[deviceId];
  if (!state) return;
  if (state.fenceCircle) map.removeLayer(state.fenceCircle);
  state.fenceCircle = null;
  if (!fence?.enabled) return;
  state.fenceCircle = L.circle([fence.lat, fence.lng], {
    radius: fence.radius_m,
    color: state.color,
    fillColor: state.color,
    fillOpacity: 0.12,
    weight: 2,
    dashArray: "8 6",
  }).addTo(map);
}

function setGeofencePlaceMode(on) {
  geofencePlaceMode = on;
  btnPlaceZone.textContent = on ? "Cancel placement" : "Click map to place zone";
  btnPlaceZone.classList.toggle("active", on);
  map.getContainer().style.cursor = on ? "crosshair" : "";
  if (!on) {
    elGeofenceHint.textContent = selectedDeviceId
      ? "Adjust radius or move the zone center."
      : "Choose a device from the list above to set an alert boundary on the map.";
  }
}

function onMapClick(e) {
  if (!geofencePlaceMode || !selectedDeviceId) return;
  setGeofencePlaceMode(false);
  saveGeofence(selectedDeviceId, e.latlng.lat, e.latlng.lng).catch((err) => {
    console.warn(err);
    showToast("Could not save safe zone. Try again.", "error");
  });
}

function showToast(message, type = "info") {
  const el = document.createElement("div");
  el.className = "alert-banner toast-" + type;
  el.style.background = type === "error" ? "rgba(127, 29, 29, 0.96)" : "rgba(10, 37, 64, 0.95)";
  el.style.borderColor = type === "error" ? "rgba(248, 113, 113, 0.45)" : "rgba(245, 166, 35, 0.35)";
  el.innerHTML = `<span class="alert-msg">${escapeHTML(message)}</span>`;
  elAlertStack?.prepend(el);
  setTimeout(() => el.remove(), 3000);
}

async function saveGeofence(deviceId, lat, lng) {
  const radius = parseInt(elGeofenceRadius.value, 10);
  const res = await fetch("/api/geofences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId, lat, lng, radius_m: radius, enabled: true }),
  });
  if (!res.ok) throw new Error("Failed to save geofence");
  const fence = await res.json();
  geofences[deviceId] = fence;
  const device = allDevices.find((d) => d.id === deviceId);
  const pos = device && devicePosition(device);
  if (pos) checkGeofence(device, pos.lat, pos.lng);
  else geofenceInside[deviceId] = null;
  drawGeofenceCircle(deviceId);
  updateGeofencePanel();
  renderDeviceList(allDevices);
  return fence;
}

let _radiusSaveTimer = null;
function applyRadiusToSelectedFence(radiusM) {
  if (!selectedDeviceId) return;
  const fence = geofences[selectedDeviceId];
  if (!fence?.enabled) return;

  fence.radius_m = radiusM;
  // Update circle immediately if it exists
  const circle = deviceState[selectedDeviceId]?.fenceCircle;
  if (circle?.setRadius) circle.setRadius(radiusM);
  // Re-check zone status + badges immediately
  const device = allDevices.find((d) => d.id === selectedDeviceId);
  const pos = device && devicePosition(device);
  if (pos) checkGeofence(device, pos.lat, pos.lng);
  updateGeofencePanel();
  renderDeviceList(allDevices);
}

async function persistSelectedFenceRadius(radiusM) {
  if (!selectedDeviceId) return;
  const fence = geofences[selectedDeviceId];
  if (!fence?.enabled) return;
  try {
    // Temporarily set slider value so saveGeofence uses this radius.
    const prev = elGeofenceRadius?.value;
    if (elGeofenceRadius) elGeofenceRadius.value = String(radiusM);
    await saveGeofence(selectedDeviceId, Number(fence.lat), Number(fence.lng));
    if (elGeofenceRadius && prev != null) elGeofenceRadius.value = prev;
  } catch (err) {
    console.warn(err);
    showToast("Could not update zone radius.", "error");
  }
}

async function removeGeofence(deviceId) {
  await fetch("/api/geofences", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId }),
  });
  delete geofences[deviceId];
  delete geofenceInside[deviceId];
  drawGeofenceCircle(deviceId);
  clearAlert(deviceId);
  updateGeofencePanel();
}

function updateGeofencePanel() {
  if (!selectedDeviceId) {
    elGeofencePanel.classList.add("geofence-panel--idle");
    elGeofenceControls.hidden = true;
    elSelectedBlock.hidden = true;
    elGeofenceHint.textContent = "Choose a device from the list above to set an alert boundary on the map.";
    return;
  }

  const device = allDevices.find((d) => d.id === selectedDeviceId);
  const fence = geofences[selectedDeviceId];
  const name = device?.name || selectedDeviceId;

  elGeofencePanel.classList.remove("geofence-panel--idle");
  elGeofenceControls.hidden = false;
  elSelectedBlock.hidden = false;
  elSelectedName.textContent = name;
  elSelectedId.textContent = selectedDeviceId;

  elGeofenceHint.textContent = geofencePlaceMode
    ? "Click anywhere on the map to set the zone center."
    : "Set a circular boundary. You will be alerted if the device leaves it.";

  if (fence) {
    elGeofenceRadius.value = fence.radius_m;
    elGeofenceRadiusVal.textContent = fence.radius_m;
    const inside = zoneInsideFor(selectedDeviceId);
    if (inside === true) {
      elGeofenceStatus.textContent = "Device is inside the safe zone";
      elGeofenceStatusPill.dataset.state = "inside";
    } else if (inside === false) {
      elGeofenceStatus.textContent = "Device is outside the safe zone";
      elGeofenceStatusPill.dataset.state = "outside";
    } else {
      elGeofenceStatus.textContent = `Zone active · ${fence.radius_m} m radius`;
      elGeofenceStatusPill.dataset.state = "set";
    }
  } else {
    elGeofenceStatus.textContent = "No safe zone — set one below";
    elGeofenceStatusPill.dataset.state = "none";
    elGeofenceRadiusVal.textContent = elGeofenceRadius.value;
  }
}

function checkGeofence(device, lat, lng) {
  const fence = geofences[device.id];
  if (!fence?.enabled) {
    geofenceInside[device.id] = null;
    return;
  }

  const dist = haversineMeters(lat, lng, Number(fence.lat), Number(fence.lng));
  const inside = dist <= Number(fence.radius_m);
  const wasInside = geofenceInside[device.id];
  geofenceInside[device.id] = inside;

  if (inside === false && wasInside !== false) {
    showAlert(
      device.id,
      device.name,
      `Left the safe zone — ${Math.round(dist)} m from center (limit ${Math.round(fence.radius_m)} m)`
    );
  }
  if (inside) clearAlert(device.id);
}

function recalculateAllGeofences() {
  allDevices.forEach((device) => {
    const pos = devicePosition(device);
    if (pos) checkGeofence(device, pos.lat, pos.lng);
  });
}

function renderDeviceList(devices) {
  const query = (elSearch.value || "").toLowerCase();
  const filtered = devices
    .filter((d) => d.name.toLowerCase().includes(query) || String(d.id).toLowerCase().includes(query))
    .sort((a, b) => {
      const aOnline = isOnline(a) ? 1 : 0;
      const bOnline = isOnline(b) ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline; // Online first
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
  elDeviceCount.textContent = devices.length;

  if (!elDeviceList) return;
  if (filtered.length === 0) {
    elDeviceList.innerHTML = `<div style="color:rgba(138,155,176,0.95);padding:0.75rem 0;">No matches</div>`;
    return;
  }

  elDeviceList.innerHTML = filtered
    .map((d, idx) => {
      const state = deviceState[d.id];
      const color = state?.color || DEVICE_COLORS[idx % DEVICE_COLORS.length];
      const online = isOnline(d);
      const active = selectedDeviceId === d.id ? "active" : "";
      const outsideZone = zoneInsideFor(d.id) === false;
      return `
        <div class="device-row ${active}${outsideZone ? " zone-breach" : ""}" data-id="${escapeHTML(d.id)}" role="listitem">
          <span class="device-color-dot" style="background:${color};"></span>
          <div class="device-body">
            <div class="device-name">${escapeHTML(d.name)}</div>
            <div class="device-id-tag">${escapeHTML(d.id)}</div>
            <div class="device-badges">
              <span class="device-badge ${online ? "zone-inside" : "zone-none"}">${online ? "Online" : "Offline"}</span>
              ${zoneBadgeFor(d.id)}
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  elDeviceList.querySelectorAll(".device-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.id;
      if (id) selectDevice(id);
    });
  });
}

function deviceLatLng(deviceId) {
  const device = allDevices.find((d) => d.id === deviceId);
  const pos = device && devicePosition(device);
  if (pos) return L.latLng(pos.lat, pos.lng);

  const ll = deviceState[deviceId]?.marker?.getLatLng?.();
  if (!ll || (ll.lat === 20 && ll.lng === 0)) return null;
  return ll;
}

function centerMapOnDevice(deviceId, { showError = false } = {}) {
  if (!map) return false;
  const ll = deviceLatLng(deviceId);
  if (!ll) {
    if (showError) showToast("No GPS position for this device yet.", "error");
    return false;
  }
  map.flyTo(ll, DEFAULT_ZOOM, { duration: 1.2 });
  return true;
}

function selectDevice(id) {
  selectedDeviceId = id;
  setGeofencePlaceMode(false);
  updateGeofencePanel();
  renderDeviceList(allDevices);

  const state = deviceState[id];
  if (state?.marker) {
    closeAllDevicePopups();
    state.marker.openPopup();
  }
  centerMapOnDevice(id);
}

function closeAllDevicePopups() {
  Object.values(deviceState).forEach((s) => {
    if (s?.marker?.closePopup) s.marker.closePopup();
  });
  if (snapshotMarker?.closePopup) snapshotMarker.closePopup();
}

function makeMarkerIcon(color, online) {
  const offlineColor = "#94a3b8";
  const glow = online
    ? `0 0 0 4px ${color}55, 0 4px 12px rgba(0,0,0,0.35)`
    : `0 0 0 4px rgba(148,163,184,0.35), 0 4px 12px rgba(0,0,0,0.35)`;
  const bg = online ? color : offlineColor;
  return L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;background:${bg};border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:${glow};transition:background 0.4s,box-shadow 0.4s;"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -34],
  });
}

function loadSnapshotFocus() {
  try {
    const raw = sessionStorage.getItem(MAP_FOCUS_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(MAP_FOCUS_KEY);
    const data = JSON.parse(raw);
    const deviceId = data.deviceId;
    const lat = parseFloat(data.lat);
    const lng = parseFloat(data.lng);
    if (!deviceId || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
    return { deviceId: String(deviceId), lat, lng };
  } catch {
    return null;
  }
}

function applySnapshotFocusIfAny() {
  if (!map || !snapshot) return;
  selectedDeviceId = snapshot.deviceId;
  updateGeofencePanel();

  // Keep a dedicated marker at snapshot coords, so camera/popup don't drift.
  if (!snapshotMarker) {
    snapshotMarker = L.marker([snapshot.lat, snapshot.lng], {
      icon: makeMarkerIcon("#F5A623", true),
    }).addTo(map);
  } else {
    snapshotMarker.setLatLng([snapshot.lat, snapshot.lng]);
  }

  snapshotMarker.bindPopup(buildPopup({ name: snapshot.deviceId }, snapshot.lat, snapshot.lng, "Looking up address...", true));
  snapshotMarker.openPopup();

  // Address load
  resolveAddress(snapshot.lat, snapshot.lng).then((addressHtml) => {
    snapshotMarker.setPopupContent(
      buildPopup({ name: snapshot.deviceId }, snapshot.lat, snapshot.lng, addressHtml || formatCoordsFallback(snapshot.lat, snapshot.lng))
    );
  });

  map.setView([snapshot.lat, snapshot.lng], DEFAULT_ZOOM, { animate: true, duration: 0.8 });
}

function resolveAddress(lat, lng) {
  const key = geoCacheKey(lat, lng);
  if (geocodeResultCache.has(key)) return Promise.resolve(geocodeResultCache.get(key));

  return queueReverseGeocode(lat, lng).then((addr) => {
    const normalized = normalizeAddressText(addr);
    geocodeResultCache.set(key, normalized);
    return normalized;
  });
}

function fitMapToAllDevices() {
  if (!map) return;

  const points = [];
  allDevices.forEach((d) => {
    const lat = parseFloat(d.latitude);
    const lng = parseFloat(d.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      points.push(L.latLng(lat, lng));
    }
  });
  Object.values(geofences).forEach((f) => {
    if (f?.enabled && Number.isFinite(f.lat) && Number.isFinite(f.lng)) {
      points.push(L.latLng(f.lat, f.lng));
    }
  });

  if (points.length === 0) return;
  if (points.length === 1) {
    map.setView(points[0], DEFAULT_ZOOM, { animate: true });
    return;
  }
  const bounds = L.latLngBounds(points);
  map.fitBounds(bounds, { padding: [56, 56], maxZoom: 15, animate: true });
}

async function loadGeofences() {
  try {
    const res = await fetch("/api/geofences");
    if (!res.ok) return;
    const list = await res.json();
    const nextIds = new Set();
    list.forEach((f) => {
      const id = normalizeDeviceId(f.device_id);
      nextIds.add(id);
      const isNew = !geofences[id];
      geofences[id] = { ...f, device_id: id };
      if (isNew) geofenceInside[id] = null;
      drawGeofenceCircle(id);
    });
    Object.keys(geofences).forEach((id) => {
      if (!nextIds.has(id)) {
        delete geofences[id];
        delete geofenceInside[id];
        if (deviceState[id]?.fenceCircle) {
          map.removeLayer(deviceState[id].fenceCircle);
          deviceState[id].fenceCircle = null;
        }
      }
    });
    recalculateAllGeofences();
  } catch (err) {
    console.warn("Geofence load error:", err);
  }
}

async function fetchDevices() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  updateAll(Array.isArray(data) ? data : [data]);
}

function updateAll(devices) {
  allDevices = devices;

  let onlineCount = 0;

  devices.forEach((device, index) => {
    const deviceId = normalizeDeviceId(device.id);
    device.id = deviceId;
    const lat = parseFloat(device.latitude);
    const lng = parseFloat(device.longitude);
    const online = isOnline(device);
    if (online) onlineCount += 1;

    const validPos = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

    if (!deviceState[deviceId]) {
      const color = DEVICE_COLORS[index % DEVICE_COLORS.length];
      const startPos = validPos ? [lat, lng] : [20, 0];
      const marker = L.marker(startPos, { icon: makeMarkerIcon(color, online) }).addTo(map);
      marker.bindPopup("");
      deviceState[deviceId] = { marker, color, fenceCircle: null };
      marker.on("click", () => {
        selectDevice(deviceId);
      });
      marker.on("popupopen", () => {
        const clicked = allDevices.find((d) => d.id === deviceId);
        if (!clicked) return;
        const clat = Number(clicked.latitude);
        const clng = Number(clicked.longitude);
        if (Number.isFinite(clat) && Number.isFinite(clng) && (clat !== 0 || clng !== 0)) {
          updateMarkerPopup(deviceState[deviceId], clicked, clat, clng, { fetchAddress: true });
        }
      });
      drawGeofenceCircle(deviceId);
    }

    const state = deviceState[deviceId];
    state.marker.setIcon(makeMarkerIcon(state.color, online));

    if (validPos) {
      state.marker.setLatLng([lat, lng]);
      const key = geoCacheKey(lat, lng);
      const moved = state._popupGeoKey !== key;
      const popupOpen = Boolean(state.marker.isPopupOpen?.());
      if (popupOpen) {
        updateMarkerPopup(state, device, lat, lng, { fetchAddress: true });
      } else if (moved || !state.marker.getPopup()?.getContent()) {
        updateMarkerPopup(state, device, lat, lng, { fetchAddress: false });
      }

      checkGeofence(device, lat, lng);
    }
  });

  updateHeaderStatus(onlineCount, devices.length);
  renderDeviceList(devices);
  updateGeofencePanel();
  if (elLastUpdateTime) {
    elLastUpdateTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
}

// Map init
function initMap() {
  snapshot = loadSnapshotFocus();
  const initialCenter = snapshot ? [snapshot.lat, snapshot.lng] : [20, 0];
  const initialZoom = snapshot ? DEFAULT_ZOOM : 3;

  map = L.map("map", { center: initialCenter, zoom: initialZoom, zoomControl: true, attributionControl: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
  map.on("click", onMapClick);

  if (snapshot) {
    applySnapshotFocusIfAny();
  }
}

// UI wiring
btnFit?.addEventListener("click", fitMapToAllDevices);
btnPlaceZone?.addEventListener("click", () => {
  if (!selectedDeviceId) {
    showToast("Select a device from the list first.", "error");
    return;
  }
  setGeofencePlaceMode(!geofencePlaceMode);
});
btnCenterDevice?.addEventListener("click", () => {
  if (!selectedDeviceId) return;
  centerMapOnDevice(selectedDeviceId, { showError: true });
});
btnPlaceZoneDevice?.addEventListener("click", () => {
  if (!selectedDeviceId) {
    showToast("Select a device from the list first.", "error");
    return;
  }
  const state = deviceState[selectedDeviceId];
  const ll = state?.marker?.getLatLng?.();
  if (!ll || (ll.lat === 20 && ll.lng === 0)) {
    showToast("No GPS position for this device yet.", "error");
    return;
  }
  saveGeofence(selectedDeviceId, ll.lat, ll.lng).catch(() => {
    showToast("Could not save safe zone.", "error");
  });
});
btnClearZone?.addEventListener("click", () => {
  if (!selectedDeviceId) return;
  removeGeofence(selectedDeviceId).catch((err) => {
    console.warn(err);
    showToast("Could not remove safe zone.", "error");
  });
});

elGeofenceRadius?.addEventListener("input", () => {
  if (elGeofenceRadiusVal) elGeofenceRadiusVal.textContent = elGeofenceRadius.value;
  const radiusM = parseInt(elGeofenceRadius.value, 10);
  if (Number.isFinite(radiusM)) applyRadiusToSelectedFence(radiusM);
  // Debounced persist
  if (_radiusSaveTimer) clearTimeout(_radiusSaveTimer);
  _radiusSaveTimer = setTimeout(() => {
    persistSelectedFenceRadius(radiusM);
    _radiusSaveTimer = null;
  }, 450);
});
document.querySelectorAll(".preset-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const v = Number(chip.getAttribute("data-radius"));
    if (!Number.isFinite(v)) return;
    elGeofenceRadius.value = String(v);
    if (elGeofenceRadiusVal) elGeofenceRadiusVal.textContent = String(v);
    // Programmatic slider changes do not fire the "input" event in all browsers,
    // so call the same logic as the slider handler.
    applyRadiusToSelectedFence(v);
    // Debounced persist to backend
    if (_radiusSaveTimer) clearTimeout(_radiusSaveTimer);
    _radiusSaveTimer = setTimeout(() => {
      persistSelectedFenceRadius(v);
      _radiusSaveTimer = null;
    }, 450);
  });
});

elSearch?.addEventListener("input", () => renderDeviceList(allDevices));

async function refreshMapData() {
  await loadGeofences();
  await fetchDevices();
}

// Init
initMap();
refreshMapData().catch((err) => {
  console.warn("GPS fetch error:", err);
  updateHeaderStatus(false, 0);
});
setInterval(() => {
  refreshMapData().catch(() => {});
}, POLL_INTERVAL);

>>>>>>> Stashed changes
