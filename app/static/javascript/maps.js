
const API_URL      = 'http://localhost:5001/api/gps'; 
const POLL_INTERVAL = 3000;  
const DEFAULT_ZOOM  = 16;

let map, marker, polyline;
let pathCoords   = [];
let trackingPath = false;
let lastLat = null, lastLng = null;

const elLat       = document.getElementById('val-lat');
const elLng       = document.getElementById('val-lng');
const elAlt       = document.getElementById('val-alt');
const elSpeed     = document.getElementById('val-speed');
const elCourse    = document.getElementById('val-course');
const elSats      = document.getElementById('val-sats');
const elDatetime  = document.getElementById('val-datetime');
const elFix       = document.getElementById('val-fix');
const elStatus    = document.getElementById('status-text');
const elDot       = document.getElementById('status-dot');
const elLastUpd   = document.getElementById('last-update-time');
const elBadgeDot  = document.querySelector('.badge-dot');
const elBadgeLbl  = document.getElementById('badge-label');
const btnCenter   = document.getElementById('btn-center');
const btnTrack    = document.getElementById('btn-track');

function spawnParticles () {
  const canvas = document.querySelector('.sky-canvas');
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 4 + 2;
    p.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random()*100}%;
      bottom:${Math.random()*20}%;
      animation-duration:${Math.random()*12+8}s;
      animation-delay:${Math.random()*8}s;
    `;
    canvas.appendChild(p);
  }
}
spawnParticles();

window.addEventListener('scroll', () => {
  document.getElementById('site-header')
    .classList.toggle('scrolled', window.scrollY > 10);
});

function initMap () {
  map = L.map('map', {
    center: [20, 0],
    zoom: 3,
    zoomControl: true,
    attributionControl: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(map);

  const markerIcon = L.divIcon({
    className: '',
    html: '<div class="custom-marker"></div>',
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -40],
  });

  marker = L.marker([20, 0], { icon: markerIcon }).addTo(map);
  marker.bindPopup('');

  polyline = L.polyline([], {
    color: 'rgba(245,166,35,0.7)',
    weight: 3,
    dashArray: '6 4',
  }).addTo(map);
}

function updateUI (data) {
  const lat  = parseFloat(data.latitude);
  const lng  = parseFloat(data.longitude);
  const valid = data.fix_valid === true || data.fix_valid === 'true';

  elLat.textContent   = lat.toFixed(6) + '° ' + (lat >= 0 ? 'N' : 'S');
  elLng.textContent   = lng.toFixed(6) + '° ' + (lng >= 0 ? 'E' : 'W');
  elAlt.textContent   = data.altitude_m    + ' m';
  elSpeed.textContent = data.speed_kmph    + ' km/h';
  elCourse.textContent= data.course_deg    + '°';
  elSats.textContent  = data.satellites;
  elDatetime.textContent = data.datetime   || '—';
  elFix.textContent   = valid ? '✅ Valid' : '⚠️ Invalid';

  if (valid) {
    setStatus('live', 'Live — GPS fix acquired');
    setBadge('live', 'Live');
  } else {
    setStatus('error', 'No fix — searching…');
    setBadge('', 'No Fix');
  }

  elLastUpd.textContent = new Date().toLocaleTimeString();

  if (valid && !isNaN(lat) && !isNaN(lng)) {
    const latlng = [lat, lng];

    marker.setLatLng(latlng);
    marker.setPopupContent(`
      <div class="popup-title">📍 Device Location</div>
      <b>Lat:</b> ${lat.toFixed(6)}<br>
      <b>Lng:</b> ${lng.toFixed(6)}<br>
      <b>Alt:</b> ${data.altitude_m} m<br>
      <b>Speed:</b> ${data.speed_kmph} km/h
    `);

    if (lastLat === null) {
      map.setView(latlng, DEFAULT_ZOOM);
    }

    if (trackingPath) {
      pathCoords.push(latlng);
      polyline.setLatLngs(pathCoords);
    }

    lastLat = lat;
    lastLng = lng;
  }
}

function setStatus (state, text) {
  elDot.className   = 'status-dot ' + state;
  elStatus.textContent = text;
}

function setBadge (state, label) {
  elBadgeDot.className = 'badge-dot ' + state;
  elBadgeLbl.textContent = label;
}

async function fetchGPS () {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    updateUI(data);
  } catch (err) {
    setStatus('error', 'Cannot reach server');
    setBadge('', 'Offline');
    console.warn('GPS fetch error:', err);
  }
}

btnCenter.addEventListener('click', () => {
  if (lastLat !== null) {
    map.flyTo([lastLat, lastLng], DEFAULT_ZOOM, { duration: 1.2 });
  }
});

btnTrack.addEventListener('click', () => {
  trackingPath = !trackingPath;
  if (trackingPath) {
    btnTrack.textContent  = '⏹ Stop Tracking';
    btnTrack.style.background = 'rgba(231,76,60,0.15)';
    btnTrack.style.borderColor = 'var(--danger)';
    pathCoords = lastLat !== null ? [[lastLat, lastLng]] : [];
  } else {
    btnTrack.textContent = '◉ Track Path';
    btnTrack.style.background = '';
    btnTrack.style.borderColor = '';
  }
});

initMap();
fetchGPS();                                 
setInterval(fetchGPS, POLL_INTERVAL);         