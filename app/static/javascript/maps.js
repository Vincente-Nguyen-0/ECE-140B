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
