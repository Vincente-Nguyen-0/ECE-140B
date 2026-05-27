const API_URL = "/api/devices";
const POLL_INTERVAL = 3000;
const DEFAULT_CENTER = [32.7157, -117.1611];
const DEFAULT_ZOOM = 12;
const DEVICE_ZOOM = 16;
const GEOCODE_MIN_INTERVAL_MS = 120;
const GEOCODE_TIMEOUT_MS = 4500;
const GEOCODE_POPUP_WAIT_MS = 3500;
const MAP_FOCUS_KEY = "eshady_map_focus";

const DEVICE_COLORS = [
  "#F5A623", "#22c55e", "#3b82f6", "#a855f7", "#ef4444", "#06b6d4",
  "#f97316", "#84cc16", "#ec4899", "#14b8a6", "#8b5cf6", "#f59e0b",
];

let map;
let allDevices = [];
let selectedDeviceId = null;
let geofencePlaceMode = false;
let snapshot = null;
let snapshotMarker = null;
let geocodeChain = Promise.resolve();
let radiusSaveTimer = null;
let hasAutoFit = false;

const deviceState = {};
const geofences = {};
const geofenceInside = {};
const activeAlerts = new Map();
const geocodeResultCache = new Map();

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

function normalizeAddressText(value) {
  if (!value) return null;
  return String(value)
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,+/g, ",")
    .replace(/^,\s*|\s*,$/g, "")
    .trim();
}

function formatCoordsFallback(lat, lng) {
  const latStr = `${Math.abs(lat).toFixed(5)} deg ${lat >= 0 ? "N" : "S"}`;
  const lngStr = `${Math.abs(lng).toFixed(5)} deg ${lng >= 0 ? "E" : "W"}`;
  return `${latStr}, ${lngStr}`;
}

function devicePosition(device) {
  const lat = parseFloat(device?.latitude);
  const lng = parseFloat(device?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

function isOnline(device) {
  if (!device?.received_at) return false;
  const receivedAt = new Date(device.received_at);
  const ageMs = Date.now() - receivedAt.getTime();
  const fixValid = device.fix_valid === true || device.fix_valid === "true" || device.fix_valid === 1;
  return ageMs <= 15000 && fixValid;
}

function deviceAddressLabel(device) {
  return normalizeAddressText(device?.address_label);
}

function buildPopup(device, lat, lng, addressHtml, loading = false) {
  const addrClass = loading ? "popup-address loading" : "popup-address";
  const addrBody = addressHtml || (loading ? "Looking up address..." : escapeHTML(deviceAddressLabel(device) || "Location unavailable"));
  return `
    <div class="popup-device-id">${escapeHTML(device.name || device.id)}</div>
    <div class="${addrClass}">${addrBody}</div>
    <div class="popup-coords">${formatCoordsFallback(lat, lng)}</div>
  `;
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
    if (err.name !== "AbortError") console.warn("Geocode error", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function queueReverseGeocode(lat, lng) {
  const key = geoCacheKey(lat, lng);
  if (geocodeResultCache.has(key)) return Promise.resolve(geocodeResultCache.get(key) || null);
  const run = geocodeChain.then(() => fetchGeocode(lat, lng));
  geocodeChain = run
    .then((addr) => {
      geocodeResultCache.set(key, addr || "");
      return new Promise((resolve) => setTimeout(resolve, GEOCODE_MIN_INTERVAL_MS));
    })
    .catch(() => new Promise((resolve) => setTimeout(resolve, GEOCODE_MIN_INTERVAL_MS)));
  return run;
}

function resolveAddress(lat, lng) {
  const key = geoCacheKey(lat, lng);
  if (geocodeResultCache.has(key)) return Promise.resolve(geocodeResultCache.get(key));
  return queueReverseGeocode(lat, lng).then((addr) => {
    const normalized = normalizeAddressText(addr);
    geocodeResultCache.set(key, normalized || "");
    return normalized;
  });
}

function resolveAddressWithTimeout(lat, lng, ms = GEOCODE_POPUP_WAIT_MS) {
  return Promise.race([
    resolveAddress(lat, lng),
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const r = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function makeMarkerIcon(color, online) {
  const offlineColor = "#94a3b8";
  const bg = online ? color : offlineColor;
  const glow = online
    ? `0 0 0 4px ${color}55, 0 4px 12px rgba(0,0,0,0.35)`
    : "0 0 0 4px rgba(148,163,184,0.35), 0 4px 12px rgba(0,0,0,0.35)";
  return L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;background:${bg};border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:${glow};transition:background 0.4s,box-shadow 0.4s;"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -34],
  });
}

function setButtonState(button, active, label) {
  if (!button) return;
  button.classList.toggle("is-active", Boolean(active));
  button.setAttribute("aria-pressed", active ? "true" : "false");
  if (label) button.textContent = label;
}

function setRadiusValue(radiusM, { syncSlider = true, updatePreset = true } = {}) {
  const radius = String(Math.round(Number(radiusM) || 200));
  if (syncSlider && elGeofenceRadius) elGeofenceRadius.value = radius;
  if (elGeofenceRadiusVal) elGeofenceRadiusVal.textContent = radius;
  if (updatePreset) {
    document.querySelectorAll(".preset-chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip.getAttribute("data-radius") === radius);
      chip.setAttribute("aria-pressed", chip.classList.contains("is-active") ? "true" : "false");
    });
  }
}

function updateHeaderStatus(onlineCount, deviceCount) {
  const hasDevices = deviceCount > 0;
  const live = onlineCount > 0 && hasDevices;
  if (elStatusDot) elStatusDot.className = "indicator-dot " + (live ? "live" : "offline");
  if (!elStatusLabel) return;
  if (!hasDevices) elStatusLabel.textContent = "Waiting for devices";
  else if (live) elStatusLabel.textContent = `${onlineCount} device${onlineCount === 1 ? "" : "s"} live`;
  else elStatusLabel.textContent = `${deviceCount} detected`;
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
    <span class="alert-icon" aria-hidden="true">!</span>
    <div class="alert-body">
      <span class="alert-title">${escapeHTML(title)}</span>
      <span class="alert-msg">${escapeHTML(message)}</span>
    </div>
    <button type="button" class="alert-dismiss" aria-label="Dismiss">x</button>
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

function computeInsideZone(deviceId, lat, lng) {
  const fence = geofences[deviceId];
  if (!fence?.enabled) return null;
  const dist = haversineMeters(lat, lng, Number(fence.lat), Number(fence.lng));
  return dist <= Number(fence.radius_m);
}

function zoneInsideFor(deviceId) {
  if (geofenceInside[deviceId] === true || geofenceInside[deviceId] === false) return geofenceInside[deviceId];
  const device = allDevices.find((d) => d.id === deviceId);
  const pos = device && devicePosition(device);
  return pos ? computeInsideZone(deviceId, pos.lat, pos.lng) : null;
}

function zoneBadgeFor(deviceId) {
  const fence = geofences[deviceId];
  if (!fence?.enabled) return '<span class="device-badge zone-none">No zone</span>';
  const inside = zoneInsideFor(deviceId);
  if (inside === true) return '<span class="device-badge zone-inside">In safe zone</span>';
  if (inside === false) return '<span class="device-badge zone-outside">Outside safe zone</span>';
  return '<span class="device-badge zone-none">Zone active</span>';
}

function drawGeofenceCircle(deviceId) {
  const fence = geofences[deviceId];
  const state = deviceState[deviceId];
  if (!state) return;
  if (state.fenceCircle) map.removeLayer(state.fenceCircle);
  state.fenceCircle = null;
  if (!fence?.enabled) return;
  state.fenceCircle = L.circle([Number(fence.lat), Number(fence.lng)], {
    radius: Number(fence.radius_m),
    color: state.color,
    fillColor: state.color,
    fillOpacity: 0.12,
    weight: 2,
    dashArray: "8 6",
  }).addTo(map);
}

function setGeofencePlaceMode(on) {
  geofencePlaceMode = Boolean(on);
  setButtonState(btnPlaceZone, geofencePlaceMode, geofencePlaceMode ? "Cancel placement" : "Click map to place zone");
  map.getContainer().style.cursor = geofencePlaceMode ? "crosshair" : "";
  if (!geofencePlaceMode) {
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

async function saveGeofence(deviceId, lat, lng, radiusOverride) {
  const radius = Math.round(Number(radiusOverride ?? elGeofenceRadius?.value ?? 200));
  const res = await fetch("/api/geofences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId, lat, lng, radius_m: radius, enabled: true }),
  });
  if (!res.ok) throw new Error("Failed to save geofence");
  const fence = await res.json();
  const normalizedId = normalizeDeviceId(fence.device_id || deviceId);
  geofences[normalizedId] = { ...fence, device_id: normalizedId };
  const device = allDevices.find((d) => d.id === normalizedId);
  const pos = device && devicePosition(device);
  if (pos) checkGeofence(device, pos.lat, pos.lng);
  else geofenceInside[normalizedId] = null;
  drawGeofenceCircle(normalizedId);
  if (normalizedId === selectedDeviceId) setRadiusValue(fence.radius_m);
  updateGeofencePanel();
  renderDeviceList(allDevices);
  return fence;
}

function applyRadiusToSelectedFence(radiusM) {
  if (!selectedDeviceId) return;
  const fence = geofences[selectedDeviceId];
  setRadiusValue(radiusM);
  if (!fence?.enabled) return;
  fence.radius_m = Math.round(Number(radiusM));
  const circle = deviceState[selectedDeviceId]?.fenceCircle;
  if (circle?.setRadius) circle.setRadius(fence.radius_m);
  const device = allDevices.find((d) => d.id === selectedDeviceId);
  const pos = device && devicePosition(device);
  if (pos) checkGeofence(device, pos.lat, pos.lng);
  updateGeofencePanel({ keepRadiusInput: true });
  renderDeviceList(allDevices);
}

async function persistSelectedFenceRadius(radiusM) {
  if (!selectedDeviceId) return;
  const fence = geofences[selectedDeviceId];
  if (!fence?.enabled) return;
  try {
    await saveGeofence(selectedDeviceId, Number(fence.lat), Number(fence.lng), radiusM);
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
  renderDeviceList(allDevices);
}

function updateGeofencePanel({ keepRadiusInput = false } = {}) {
  if (!selectedDeviceId) {
    elGeofencePanel.classList.add("geofence-panel--idle");
    elGeofenceControls.hidden = true;
    elSelectedBlock.hidden = true;
    elGeofenceHint.textContent = "Choose a device from the list above to set an alert boundary on the map.";
    setRadiusValue(elGeofenceRadius?.value || 200, { syncSlider: false });
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

  if (fence?.enabled) {
    if (!keepRadiusInput) setRadiusValue(fence.radius_m);
    const inside = zoneInsideFor(selectedDeviceId);
    if (inside === true) {
      elGeofenceStatus.textContent = `Device is inside the safe zone - ${Math.round(fence.radius_m)} m radius`;
      elGeofenceStatusPill.dataset.state = "inside";
    } else if (inside === false) {
      elGeofenceStatus.textContent = `Device is outside the safe zone - ${Math.round(fence.radius_m)} m radius`;
      elGeofenceStatusPill.dataset.state = "outside";
    } else {
      elGeofenceStatus.textContent = `Zone active - ${Math.round(fence.radius_m)} m radius`;
      elGeofenceStatusPill.dataset.state = "set";
    }
  } else {
    elGeofenceStatus.textContent = "No safe zone - set one below";
    elGeofenceStatusPill.dataset.state = "none";
    if (!keepRadiusInput) setRadiusValue(elGeofenceRadius?.value || 200);
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
    showAlert(device.id, device.name, `Left the safe zone - ${Math.round(dist)} m from center (limit ${Math.round(fence.radius_m)} m)`);
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
  const query = (elSearch?.value || "").toLowerCase();
  const filtered = devices
    .filter((d) => String(d.name || "").toLowerCase().includes(query) || String(d.id).toLowerCase().includes(query))
    .sort((a, b) => {
      const aOnline = isOnline(a) ? 1 : 0;
      const bOnline = isOnline(b) ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
  if (elDeviceCount) elDeviceCount.textContent = devices.length;
  if (!elDeviceList) return;
  if (filtered.length === 0) {
    elDeviceList.innerHTML = `<div class="device-empty">No devices found</div>`;
    return;
  }
  elDeviceList.innerHTML = filtered.map((d, index) => {
    const state = deviceState[d.id];
    const color = state?.color || DEVICE_COLORS[index % DEVICE_COLORS.length];
    const active = selectedDeviceId === d.id ? " active" : "";
    const outsideZone = zoneInsideFor(d.id) === false ? " zone-breach" : "";
    return `
      <button class="device-row${active}${outsideZone}" data-id="${escapeHTML(d.id)}" type="button">
        <span class="device-color-dot" style="background:${color};"></span>
        <span class="device-body">
          <span class="device-name">${escapeHTML(d.name || d.id)}</span>
          <span class="device-id-tag">${escapeHTML(d.id)}</span>
          <span class="device-badges">
            <span class="device-badge ${isOnline(d) ? "zone-inside" : "zone-none"}">${isOnline(d) ? "Online" : "Offline"}</span>
            ${zoneBadgeFor(d.id)}
          </span>
        </span>
      </button>
    `;
  }).join("");
  elDeviceList.querySelectorAll(".device-row").forEach((row) => {
    row.addEventListener("click", () => selectDevice(row.dataset.id));
  });
}

function deviceLatLng(deviceId) {
  const device = allDevices.find((d) => d.id === deviceId);
  const pos = device && devicePosition(device);
  if (pos) return L.latLng(pos.lat, pos.lng);
  const ll = deviceState[deviceId]?.marker?.getLatLng?.();
  if (!ll || (ll.lat === DEFAULT_CENTER[0] && ll.lng === DEFAULT_CENTER[1])) return null;
  return ll;
}

function centerMapOnDevice(deviceId, { showError = false } = {}) {
  const ll = deviceLatLng(deviceId);
  if (!ll) {
    if (showError) showToast("No GPS position for this device yet.", "error");
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: true });
    return false;
  }
  map.flyTo(ll, DEVICE_ZOOM, { duration: 1.2 });
  return true;
}

function selectDevice(id) {
  selectedDeviceId = normalizeDeviceId(id);
  setGeofencePlaceMode(false);
  updateGeofencePanel();
  renderDeviceList(allDevices);
  const state = deviceState[selectedDeviceId];
  if (state?.marker) {
    closeAllDevicePopups();
    state.marker.openPopup();
  }
  centerMapOnDevice(selectedDeviceId);
}

function closeAllDevicePopups() {
  Object.values(deviceState).forEach((state) => state?.marker?.closePopup?.());
  snapshotMarker?.closePopup?.();
}

function cachedAddressHtml(lat, lng) {
  const key = geoCacheKey(lat, lng);
  if (!geocodeResultCache.has(key)) return undefined;
  const hit = geocodeResultCache.get(key);
  return hit ? escapeHTML(hit) : null;
}

function updateMarkerPopup(state, device, lat, lng, { fetchAddress = false } = {}) {
  const key = geoCacheKey(lat, lng);
  const label = deviceAddressLabel(device);
  if (label) {
    state.marker.setPopupContent(buildPopup(device, lat, lng, escapeHTML(label), false));
    state.popupGeoKey = key;
    return;
  }
  const cached = cachedAddressHtml(lat, lng);
  if (cached !== undefined) {
    state.marker.setPopupContent(buildPopup(device, lat, lng, cached, false));
    state.popupGeoKey = key;
    return;
  }
  const popupOpen = Boolean(state.marker.isPopupOpen?.());
  if (!fetchAddress && !popupOpen) {
    state.popupGeoKey = key;
    state.marker.setPopupContent(buildPopup(device, lat, lng, null, false));
    return;
  }
  if (state.geocodePendingKey === key) return;
  state.geocodePendingKey = key;
  state.popupGeoKey = key;
  state.marker.setPopupContent(buildPopup(device, lat, lng, null, true));
  resolveAddressWithTimeout(lat, lng).then((addr) => {
    if (state.geocodePendingKey === key) state.geocodePendingKey = null;
    const ll = state.marker.getLatLng();
    if (geoCacheKey(ll.lat, ll.lng) !== key) return;
    state.marker.setPopupContent(buildPopup(device, lat, lng, addr ? escapeHTML(addr) : null, false));
  });
}

function loadSnapshotFocus() {
  try {
    const raw = sessionStorage.getItem(MAP_FOCUS_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(MAP_FOCUS_KEY);
    const data = JSON.parse(raw);
    const deviceId = normalizeDeviceId(data.deviceId);
    const lat = parseFloat(data.lat);
    const lng = parseFloat(data.lng);
    return { deviceId, lat, lng, hasPosition: Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) };
  } catch {
    return null;
  }
}

function applySnapshotFocusIfAny() {
  if (!map || !snapshot?.deviceId) return;
  selectedDeviceId = snapshot.deviceId;
  updateGeofencePanel();
  if (!snapshot.hasPosition) {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: true });
    return;
  }
  if (!snapshotMarker) {
    snapshotMarker = L.marker([snapshot.lat, snapshot.lng], { icon: makeMarkerIcon("#F5A623", true) }).addTo(map);
  } else {
    snapshotMarker.setLatLng([snapshot.lat, snapshot.lng]);
  }
  snapshotMarker.bindPopup(buildPopup({ name: snapshot.deviceId }, snapshot.lat, snapshot.lng, "Looking up address...", true));
  snapshotMarker.openPopup();
  resolveAddress(snapshot.lat, snapshot.lng).then((address) => {
    snapshotMarker.setPopupContent(buildPopup({ name: snapshot.deviceId }, snapshot.lat, snapshot.lng, address ? escapeHTML(address) : null));
  });
  map.setView([snapshot.lat, snapshot.lng], DEVICE_ZOOM, { animate: true, duration: 0.8 });
}

function fitMapToAllDevices() {
  const points = [];
  allDevices.forEach((device) => {
    const pos = devicePosition(device);
    if (pos) points.push(L.latLng(pos.lat, pos.lng));
  });
  Object.values(geofences).forEach((fence) => {
    const lat = Number(fence?.lat);
    const lng = Number(fence?.lng);
    if (fence?.enabled && Number.isFinite(lat) && Number.isFinite(lng)) points.push(L.latLng(lat, lng));
  });
  if (points.length === 0) {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: true });
    showToast("No device GPS yet. Showing San Diego by default.");
    return;
  }
  if (points.length === 1) {
    map.setView(points[0], DEVICE_ZOOM, { animate: true });
    return;
  }
  map.fitBounds(L.latLngBounds(points), { padding: [56, 56], maxZoom: 15, animate: true });
}

async function loadGeofences() {
  try {
    const res = await fetch("/api/geofences");
    if (!res.ok) return;
    const list = await res.json();
    const nextIds = new Set();
    list.forEach((fence) => {
      const id = normalizeDeviceId(fence.device_id);
      nextIds.add(id);
      const isNew = !geofences[id];
      geofences[id] = { ...fence, device_id: id };
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
  allDevices = devices.map((device) => ({ ...device, id: normalizeDeviceId(device.id) }));
  let onlineCount = 0;

  allDevices.forEach((device, index) => {
    const pos = devicePosition(device);
    const online = isOnline(device);
    if (online) onlineCount += 1;

    if (!deviceState[device.id]) {
      const color = DEVICE_COLORS[index % DEVICE_COLORS.length];
      const startPos = pos ? [pos.lat, pos.lng] : DEFAULT_CENTER;
      const marker = L.marker(startPos, { icon: makeMarkerIcon(color, online) }).addTo(map);
      marker.bindPopup("");
      deviceState[device.id] = { marker, color, fenceCircle: null, popupGeoKey: null, geocodePendingKey: null };
      marker.on("click", () => selectDevice(device.id));
      marker.on("popupopen", () => {
        const clicked = allDevices.find((d) => d.id === device.id);
        const clickedPos = clicked && devicePosition(clicked);
        if (clickedPos) updateMarkerPopup(deviceState[device.id], clicked, clickedPos.lat, clickedPos.lng, { fetchAddress: true });
      });
      drawGeofenceCircle(device.id);
    }

    const state = deviceState[device.id];
    state.marker.setIcon(makeMarkerIcon(state.color, online));
    if (pos) {
      state.marker.setLatLng([pos.lat, pos.lng]);
      const key = geoCacheKey(pos.lat, pos.lng);
      const moved = state.popupGeoKey !== key;
      const popupOpen = Boolean(state.marker.isPopupOpen?.());
      if (popupOpen) updateMarkerPopup(state, device, pos.lat, pos.lng, { fetchAddress: true });
      else if (moved || !state.marker.getPopup()?.getContent()) updateMarkerPopup(state, device, pos.lat, pos.lng);
      checkGeofence(device, pos.lat, pos.lng);
    }
  });

  if (selectedDeviceId && !allDevices.some((device) => device.id === selectedDeviceId)) selectedDeviceId = null;
  updateHeaderStatus(onlineCount, allDevices.length);
  renderDeviceList(allDevices);
  updateGeofencePanel();
  if (elLastUpdateTime) {
    elLastUpdateTime.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (!snapshot && !hasAutoFit && allDevices.some((device) => devicePosition(device))) {
    hasAutoFit = true;
    fitMapToAllDevices();
  }
  if (snapshot?.deviceId && allDevices.some((device) => device.id === snapshot.deviceId)) {
    selectDevice(snapshot.deviceId);
    snapshot = null;
  }
}

function initMap() {
  snapshot = loadSnapshotFocus();
  const center = snapshot?.hasPosition ? [snapshot.lat, snapshot.lng] : DEFAULT_CENTER;
  const zoom = snapshot?.hasPosition ? DEVICE_ZOOM : DEFAULT_ZOOM;
  map = L.map("map", { center, zoom, zoomControl: true, attributionControl: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
  map.on("click", onMapClick);
  applySnapshotFocusIfAny();
}

btnFit?.addEventListener("click", fitMapToAllDevices);
btnPlaceZone?.addEventListener("click", () => {
  if (!selectedDeviceId) {
    showToast("Select a device from the list first.", "error");
    return;
  }
  setGeofencePlaceMode(!geofencePlaceMode);
});
btnCenterDevice?.addEventListener("click", () => {
  if (!selectedDeviceId) {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: true });
    showToast("Select a device first. Showing San Diego.");
    return;
  }
  centerMapOnDevice(selectedDeviceId, { showError: true });
});
btnPlaceZoneDevice?.addEventListener("click", () => {
  if (!selectedDeviceId) {
    showToast("Select a device from the list first.", "error");
    return;
  }
  const ll = deviceLatLng(selectedDeviceId);
  if (!ll) {
    showToast("No GPS position for this device yet.", "error");
    return;
  }
  saveGeofence(selectedDeviceId, ll.lat, ll.lng).catch(() => showToast("Could not save safe zone.", "error"));
});
btnClearZone?.addEventListener("click", () => {
  if (!selectedDeviceId) return;
  removeGeofence(selectedDeviceId).catch((err) => {
    console.warn(err);
    showToast("Could not remove safe zone.", "error");
  });
});
elGeofenceRadius?.addEventListener("input", () => {
  const radiusM = parseInt(elGeofenceRadius.value, 10);
  if (!Number.isFinite(radiusM)) return;
  applyRadiusToSelectedFence(radiusM);
  if (radiusSaveTimer) clearTimeout(radiusSaveTimer);
  radiusSaveTimer = setTimeout(() => {
    persistSelectedFenceRadius(radiusM);
    radiusSaveTimer = null;
  }, 450);
});
document.querySelectorAll(".preset-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const radiusM = Number(chip.getAttribute("data-radius"));
    if (!Number.isFinite(radiusM)) return;
    applyRadiusToSelectedFence(radiusM);
    if (radiusSaveTimer) clearTimeout(radiusSaveTimer);
    radiusSaveTimer = setTimeout(() => {
      persistSelectedFenceRadius(radiusM);
      radiusSaveTimer = null;
    }, 450);
  });
});
elSearch?.addEventListener("input", () => renderDeviceList(allDevices));

async function refreshMapData() {
  await loadGeofences();
  await fetchDevices();
}

initMap();
refreshMapData().catch((err) => {
  console.warn("GPS fetch error:", err);
  updateHeaderStatus(0, 0);
  map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
});
setInterval(() => {
  refreshMapData().catch(() => {});
}, POLL_INTERVAL);
