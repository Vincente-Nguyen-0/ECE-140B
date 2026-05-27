const API_BASE = '/api';
const MAP_FOCUS_KEY = 'eshady_map_focus';

function normalizeAddressText(value) {
    if (!value) return null;
    return String(value)
        .replace(/<br\s*\/?>/gi, ', ')
        .replace(/\s*,\s*/g, ', ')
        .replace(/,+/g, ',')
        .replace(/^,\s*|\s*,$/g, '')
        .trim();
}

function getAuthHeaders() {
    const token = localStorage.getItem('eshady_token');
    if (!token) return {};
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
}

async function fetchJSON(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 401) {
        localStorage.removeItem('eshady_token');
        window.location.href = '/login';
        return null;
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const message = errorData?.detail || response.statusText || 'Request failed.';
        throw new Error(message);
    }

    if (response.status === 204) return null;
    return response.json();
}

function displayNameForUser(user) {
    const firstName = String(user?.first_name || '').trim();
    const lastName = String(user?.last_name || '').trim();
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    if (fullName) return fullName;
    const emailName = String(user?.email || '').split('@')[0].trim();
    return emailName || 'there';
}

function updateProfile(user) {
    const displayName = displayNameForUser(user);
    const firstInitial = displayName.charAt(0).toUpperCase() || 'U';

    const userName = document.getElementById('sidebarUserName');
    if (userName) userName.textContent = displayName;

    const userEmail = document.getElementById('sidebarUserEmail');
    if (userEmail) userEmail.textContent = user?.email || 'signed in';

    const userAvatar = document.querySelector('.user-avatar');
    if (userAvatar) userAvatar.textContent = firstInitial;

    const status = document.getElementById('dashboardStatus');
    if (status) status.textContent = `Welcome back, ${displayName}.`;
}

async function loadDashboard() {
    try {
        const user = await fetchJSON(`${API_BASE}/users/me`, { headers: getAuthHeaders() });
        if (!user) return;
        updateProfile(user);

        const stations = await fetchJSON(`${API_BASE}/dashboard/stations`, { headers: getAuthHeaders() });
        renderStations(stations || []);
        updateDashboardStatus(stations || [], user);

        try {
            const alerts = await fetchJSON(`${API_BASE}/alerts`, { headers: getAuthHeaders() });
            updateAlertsUI(alerts || []);
        } catch (err) {
            console.warn('Unable to load alerts', err);
            updateAlertsUI([]);
        }
    } catch (err) {
        console.error(err);
        showLandingError('Unable to load stations. Please sign in again.');
    }
}

function updateDashboardStatus(stations, user) {
    const status = document.getElementById('dashboardStatus');
    if (!status) return;

    const displayName = displayNameForUser(user);
    const paired = stations.filter((station) => station.paired !== false).length;
    const liveOnly = stations.filter((station) => station.paired === false && station.live_on_map).length;
    const total = stations.length;

    if (total === 0) {
        status.textContent = `Welcome back, ${displayName}. Connect a device to get started.`;
    } else if (liveOnly > 0) {
        status.textContent = `${paired} paired, ${liveOnly} ready to pair.`;
    } else {
        status.textContent = `${paired} paired device${paired === 1 ? '' : 's'} with live GPS tracking.`;
    }
}

function updateAlertsUI(alerts) {
    const count = alerts.length || 0;
    const notifDot = document.querySelector('#notifBtn .notif-dot');
    const navBadge = document.getElementById('alertsNavBadge');

    if (notifDot) notifDot.hidden = count === 0;
    if (navBadge) {
        navBadge.textContent = count > 0 ? String(count) : '0';
        navBadge.hidden = count === 0;
    }
}

function showLandingError(message) {
    const grid = document.getElementById('umbrellaGrid');
    if (!grid) return;
    grid.innerHTML = `
      <div class="dashboard-placeholder" id="stationLoading">
        <div class="placeholder-icon"><i class="fas fa-exclamation-circle"></i></div>
        <div class="placeholder-text">${escapeHTML(message)}</div>
      </div>
      ${createAddCard()}
    `;
}

function renderStations(stations) {
    const grid = document.getElementById('umbrellaGrid');
    if (!grid) return;

    const sorted = [...stations].sort((a, b) => {
        const aOnline = a.online ? 1 : 0;
        const bOnline = b.online ? 1 : 0;
        if (aOnline !== bOnline) return bOnline - aOnline;
        return String(a.name || a.device_id).localeCompare(String(b.name || b.device_id));
    });

    const stationCards = sorted.map((station) => createStationCard(station)).join('');
    grid.innerHTML = stationCards + createAddCard();
}

function createAddCard() {
    return `
      <button class="add-card" id="addCard" type="button" onclick="connectDevice()">
        <span class="add-card-icon"><i class="fas fa-plus"></i></span>
        <span class="add-card-title">Connect Device</span>
        <span class="add-card-sub">Find an ESP32 reporting GPS on this network or enter its MAC address.</span>
      </button>
    `;
}

function createStationCard(station) {
    const isPaired = station.paired !== false;
    const isLiveOnly = !isPaired && station.live_on_map;
    const statusClass = station.alert ? 'alert' : station.online ? 'online' : 'offline';
    const badgeClass = station.alert ? 'badge-alert' : station.online ? 'badge-online' : 'badge-offline';
    const statusText = station.alert ? 'Alert' : station.online ? (isLiveOnly ? 'Ready to pair' : 'Online') : 'Offline';
    const guardTitle = station.alert ? 'Outside Safe Zone' : 'Theft Guard';
    const guardSub = station.alert
        ? `${new Date(station.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - GPS logged`
        : station.safe_zone ? 'Armed - inside safe zone' : 'Disarmed';
    const cardClass = station.alert ? 'umb-card alert-active' : 'umb-card';
    const batteryWidth = Math.max(0, Math.min(100, Number(station.battery_pct) || 0));
    const pairedText = isPaired && station.paired_at ? `Paired ${formatDaysAgo(station.paired_at)}` : (isLiveOnly ? 'Discovered by GPS' : 'Not paired');
    const locationText = normalizeAddressText(station.location)
        || (station.latitude && station.longitude ? `${Number(station.latitude).toFixed(5)}, ${Number(station.longitude).toFixed(5)}` : 'Awaiting GPS location');

    return `
      <article class="${cardClass}" id="card-${escapeHTML(station.id || station.device_id)}">
        <div class="umb-card-top">
          <div class="umb-identity">
            <div class="umb-name">
              <span class="status-dot ${statusClass}"></span>
              ${escapeHTML(station.name || station.device_id)}
            </div>
            <div class="umb-id">ID: ${escapeHTML(station.device_id)} - ${escapeHTML(pairedText)}</div>
            <div class="umb-location"><i class="fas fa-map-marker-alt"></i> ${escapeHTML(locationText)}</div>
          </div>
          <span class="umb-status-badge ${badgeClass}">${escapeHTML(statusText)}</span>
        </div>

        ${isPaired ? `
        <div class="battery-row">
          <span class="battery-lbl"><i class="fas fa-battery-half"></i>&nbsp; Battery</span>
          <div class="battery-track">
            <div class="battery-fill" style="width:${batteryWidth}%"></div>
          </div>
          <span class="battery-pct">${batteryWidth}%</span>
        </div>` : ''}

        <div class="guard-row${station.alert ? ' guard-alert' : ''}">
          <div class="guard-left">
            <div class="guard-icon ${station.alert ? 'triggered' : station.safe_zone ? 'armed' : 'disarmed'}">
              <i class="fas ${station.alert ? 'fa-exclamation-triangle' : 'fa-shield-alt'}"></i>
            </div>
            <div>
              <div class="guard-title">${escapeHTML(guardTitle)}</div>
              <div class="guard-sub">${escapeHTML(guardSub)}</div>
            </div>
          </div>
          ${createGuardControl(station, isPaired)}
        </div>

        <div class="umb-actions">
          <button class="action-btn primary-action" type="button" onclick="viewOnMap('${escapeJS(station.device_id)}', ${Number(station.latitude) || 0}, ${Number(station.longitude) || 0})">
            <i class="fas fa-map-marked-alt"></i> View on Map
          </button>
          ${isPaired ? `<button class="action-btn danger-action" type="button" onclick="removeCard('card-${escapeJS(station.id || station.device_id)}', '${escapeJS(station.name || station.device_id)}', ${Number(station.id)})">
              <i class="fas fa-trash-alt"></i>
            </button>`
            : `<button class="action-btn" type="button" onclick="pairDiscoveredDevice('${escapeJS(station.device_id)}', '${escapeJS(station.name || station.device_id)}')">
                <i class="fas fa-link"></i> Pair
              </button>`
          }
        </div>
      </article>
    `;
}

function createGuardControl(station, isPaired) {
    if (!isPaired) {
        return '<span class="guard-sub connect-hint">Pair to enable theft guard.</span>';
    }
    if (station.alert) {
        return `<button class="action-btn danger-action compact-action" type="button" onclick="resolveAlert(${Number(station.id)})">Dismiss</button>`;
    }
    return `
      <label class="toggle" title="Toggle Theft Guard">
        <input type="checkbox" ${station.safe_zone ? 'checked' : ''} onchange="toggleGuard(this, ${Number(station.id)})">
        <span class="toggle-slider"></span>
      </label>
    `;
}

function escapeHTML(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeJS(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '');
}

function formatDaysAgo(value) {
    const date = new Date(value);
    const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (!Number.isFinite(days) || days < 0) return 'today';
    if (days === 0) return 'today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
}

async function discoverDevices() {
    const devices = await fetchJSON(`${API_BASE}/esp32/discover`, { headers: getAuthHeaders() });
    return devices || [];
}

async function connectDevice() {
    try {
        const devices = await discoverDevices();
        if (devices.length > 0) {
            const menu = devices
                .map((device, index) => `${index + 1}. ${device.name || 'ESP32'} - ${device.device_id}${device.online ? ' (online)' : ''}`)
                .join('\n');
            const choice = prompt(`Found ESP32 devices reporting GPS:\n\n${menu}\n\nEnter a number to pair, or enter a MAC/device ID manually.`);
            if (!choice) return;

            const selectedIndex = Number(choice.trim()) - 1;
            if (Number.isInteger(selectedIndex) && devices[selectedIndex]) {
                await pairDiscoveredDevice(devices[selectedIndex].device_id, devices[selectedIndex].name);
                return;
            }

            await pairManualDevice(choice.trim());
            return;
        }

        const manualId = prompt('No live ESP32 GPS devices were found yet. Enter the ESP32 MAC/device ID manually.');
        if (manualId) await pairManualDevice(manualId.trim());
    } catch (err) {
        toast(err.message);
    }
}

async function pairDiscoveredDevice(deviceId, suggestedName) {
    const name = prompt('Enter a friendly name for this station', suggestedName || 'E-Shady Station');
    if (!name) return;
    const location = prompt('Enter a location description', 'Current GPS location');

    await pairDevice({
        device_id: deviceId,
        name,
        location,
    });
}

async function pairManualDevice(deviceId) {
    if (!deviceId) return;
    const name = prompt('Enter a friendly name for this station', 'E-Shady Station');
    if (!name) return;
    const location = prompt('Enter a location description', 'Current GPS location');

    await pairDevice({
        device_id: deviceId,
        name,
        location,
    });
}

async function pairDevice(payload) {
    await fetchJSON(`${API_BASE}/esp32/pair`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
    });
    toast('Device paired successfully.');
    await loadDashboard();
}

function viewOnMap(deviceId, lat, lng) {
    if (!deviceId) return;
    if (lat && lng) {
        sessionStorage.setItem(MAP_FOCUS_KEY, JSON.stringify({ deviceId, lat, lng }));
    }
    window.location.href = '/map';
}

async function toggleGuard(checkbox, stationId) {
    try {
        await fetchJSON(`${API_BASE}/stations/${stationId}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ safe_zone: checkbox.checked }),
        });
        toast(`Theft guard ${checkbox.checked ? 'armed' : 'disarmed'}.`);
        await loadDashboard();
    } catch (err) {
        toast(err.message);
        checkbox.checked = !checkbox.checked;
    }
}

async function removeCard(cardId, stationName, stationId) {
    if (!stationId || !confirm(`Remove ${stationName} from your account?`)) return;
    try {
        await fetchJSON(`${API_BASE}/stations/${stationId}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });
        const card = document.getElementById(cardId);
        if (card) card.remove();
        toast(`${stationName} removed.`);
        await loadDashboard();
    } catch (err) {
        toast(err.message);
    }
}

async function resolveAlert(stationId) {
    try {
        await fetchJSON(`${API_BASE}/stations/${stationId}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ alert: false, safe_zone: true }),
        });
        toast('Alert resolved.');
        await loadDashboard();
    } catch (err) {
        toast(err.message);
    }
}

function logout() {
    localStorage.removeItem('eshady_token');
    window.location.href = '/login';
}

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach((item) => {
        item.addEventListener('click', (event) => {
            const action = event.currentTarget.getAttribute('data-action');
            if (action === 'sign-out') return logout();
            if (action === 'dashboard') return window.location.assign('/dashboard');
            if (action === 'map') return window.location.assign('/map');
            if (action === 'alerts') return window.location.assign('/alerts');
            if (action === 'settings') return toast('Settings coming soon.');
            toast('That section is coming soon.');
        });
    });

    const notifBtn = document.getElementById('notifBtn');
    if (notifBtn) {
        notifBtn.addEventListener('click', () => {
            window.location.href = '/alerts';
        });
    }
}

function updateTime() {
    const timeEl = document.getElementById('liveTime');
    if (!timeEl) return;
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toast(message) {
    const container = document.querySelector('.toast-container') || createToastContainer();
    const toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.innerHTML = `<i class="fas fa-info-circle"></i> ${escapeHTML(message)}`;
    container.appendChild(toastEl);
    setTimeout(() => {
        toastEl.style.animation = 'slide-out 0.3s ease forwards';
        setTimeout(() => toastEl.remove(), 300);
    }, 3000);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    updateTime();
    setInterval(updateTime, 1000);
    loadDashboard();
    setInterval(loadDashboard, 15000);

    const connectBtn = document.getElementById('connectUmbrellaBtn');
    if (connectBtn) {
        connectBtn.addEventListener('click', connectDevice);
    }

    window.openAddModal = connectDevice;
    window.connectDevice = connectDevice;
    window.pairDiscoveredDevice = pairDiscoveredDevice;
    window.viewOnMap = viewOnMap;
    window.toggleGuard = toggleGuard;
    window.removeCard = removeCard;
    window.resolveAlert = resolveAlert;
});
