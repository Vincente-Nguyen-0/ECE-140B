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
        return;
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const message = errorData?.detail || response.statusText || 'Request failed.';
        throw new Error(message);
    }

    if (response.status === 204) return null;
    return response.json();
}

async function loadDashboard() {
    try {
        const user = await fetchJSON(`${API_BASE}/users/me`, { headers: getAuthHeaders() });
        if (user?.first_name) {
            const userName = document.getElementById('sidebarUserName');
            if (userName) userName.textContent = user.first_name;
            const userEmail = document.getElementById('sidebarUserEmail');
            if (userEmail) userEmail.textContent = user.email;
            const userAvatar = document.querySelector('.user-avatar');
            if (userAvatar) userAvatar.textContent = user.first_name.charAt(0).toUpperCase();
            const welcomeText = document.querySelector('.topbar-left p');
            if (welcomeText) welcomeText.textContent = `Welcome back, ${user.first_name} — your stations are active.`;
        }

        const stations = await fetchJSON(`${API_BASE}/dashboard/stations`, { headers: getAuthHeaders() });
        renderStations(stations || []);
        // Fetch active alerts for current user and update UI
        try {
            const alerts = await fetchJSON(`${API_BASE}/alerts`, { headers: getAuthHeaders() });
            updateAlertsUI(alerts || []);
        } catch (e) {
            console.warn('Unable to load alerts', e);
        }
        const status = document.getElementById('dashboardStatus');
        if (status) {
            const list = stations || [];
            const paired = list.filter(s => s.paired).length;
            const liveOnly = list.filter(s => !s.paired && s.live_on_map).length;
            const total = list.length;
            if (total === 0) status.textContent = 'No umbrellas yet. Pair a device to get started.';
            else if (liveOnly > 0) status.textContent = `${paired} paired · ${liveOnly} live on map · ${total} total device${total === 1 ? '' : 's'}.`;
            else status.textContent = `${paired} paired umbrella${paired === 1 ? '' : 's'} · live location updates.`;
        }
    } catch (err) {
        console.error(err);
        showLandingError('Unable to load stations. Please sign in again.');
    }
}

function updateAlertsUI(alerts) {
    const notifBtn = document.getElementById('notifBtn');
    const notifDot = notifBtn ? notifBtn.querySelector('.notif-dot') : null;
    const sidebarAlertBtn = Array.from(document.querySelectorAll('.nav-item')).find(n => n.getAttribute('data-action') === 'alerts');
    const navBadge = sidebarAlertBtn ? sidebarAlertBtn.querySelector('.nav-badge') : null;

    const count = alerts.length || 0;
    if (notifDot) notifDot.style.display = count > 0 ? 'inline-block' : 'none';
    if (navBadge) {
        navBadge.textContent = count > 0 ? String(count) : '';
        navBadge.style.display = count > 0 ? 'inline-block' : 'none';
    }
}

function showLandingError(message) {
    const placeholder = document.getElementById('stationLoading');
    if (placeholder) {
        placeholder.innerHTML = `<div class="placeholder-icon"><i class="fas fa-exclamation-circle"></i></div><div class="placeholder-text">${message}</div>`;
    }
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

    const stationCards = sorted.map(station => createStationCard(station)).join('');
    const addCard = `
      <div class="add-card" id="addCard" onclick="openAddModal()">
        <div class="add-card-icon"><i class="fas fa-plus"></i></div>
        <div class="add-card-title">Connect Umbrella</div>
        <div class="add-card-sub">Pair a new E·Shady device using its unique device ID (MAC-based or board ID).</div>
      </div>
    `;

    grid.innerHTML = stationCards + addCard;
}

function createStationCard(station) {
    const isPaired = station.paired !== false;
    const isLiveOnly = !isPaired && station.live_on_map;
    const statusClass = station.online ? 'online' : 'offline';
    const badgeClass = station.alert ? 'badge-alert' : station.online ? 'badge-online' : 'badge-offline';
    const statusText = station.alert ? '⚠ Alert' : station.online ? (isLiveOnly ? '● Live on map' : '● Online') : 'Offline';
    const guardTitle = station.alert ? 'Outside Safezone!' : 'Theft Guard';
    const guardSub = station.alert ? `${new Date(station.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · GPS logged` : station.safe_zone ? 'Armed · Inside Safezone' : 'Disarmed';
    const cardClass = station.alert ? 'umb-card alert-active' : 'umb-card';
    const batteryWidth = Math.max(0, Math.min(100, station.battery_pct));
    const pairedText = isPaired && station.paired_at ? `Paired ${formatDaysAgo(station.paired_at)}` : (isLiveOnly ? 'Seen on map' : 'Not paired');
    const locationText = normalizeAddressText(station.location)
        || (station.latitude && station.longitude ? `${station.latitude.toFixed(5)}, ${station.longitude.toFixed(5)}` : 'Awaiting GPS location');

    return `
      <div class="${cardClass}" id="card-${station.id || station.device_id}">
        <div class="umb-card-top">
          <div class="umb-identity">
            <div class="umb-name">
              <span class="status-dot ${statusClass}"></span>
              ${escapeHTML(station.name)}
            </div>
            <div class="umb-id">ID: ${escapeHTML(station.device_id)} · ${escapeHTML(pairedText)}</div>
            <div class="umb-location"><i class="fas fa-map-marker-alt" style="color:${station.alert ? 'var(--danger)' : 'var(--sun)'};font-size:0.65rem;"></i> ${escapeHTML(locationText)}</div>
          </div>
          <span class="umb-status-badge ${badgeClass}">${statusText}</span>
        </div>

        <div class="umb-metrics">
          <!-- Metrics removed; battery progress bar remains below -->
        </div>

        ${isPaired ? `
        <div class="battery-row">
          <span class="battery-lbl"><i class="fas fa-battery-half"></i>&nbsp; Battery</span>
          <div class="battery-track">
            <div class="battery-fill" style="width:${batteryWidth}%"></div>
          </div>
          <span class="battery-pct">${batteryWidth}%</span>
        </div>` : ''}

        <div class="guard-row" style="${station.alert ? 'background:rgba(231,76,60,0.04);' : ''}">
          <div class="guard-left">
            <div class="guard-icon ${station.alert ? 'triggered' : 'armed'}"><i class="fas ${station.alert ? 'fa-exclamation-triangle' : 'fa-shield-alt'}"></i></div>
            <div>
              <div class="guard-title" style="${station.alert ? 'color:var(--danger);' : ''}">${escapeHTML(guardTitle)}</div>
              <div class="guard-sub">${escapeHTML(guardSub)}</div>
            </div>
          </div>
          ${isPaired ? (
              station.alert
                ? `<button class="action-btn danger-action" style="width:auto;padding:0.35rem 0.8rem;font-size:0.72rem;" onclick="resolveAlert(${station.id})">Dismiss</button>`
                : `<label class="toggle" title="Toggle Theft Guard">
                    <input type="checkbox" ${station.safe_zone ? 'checked' : ''} onchange="toggleGuard(this, ${station.id})">
                    <span class="toggle-slider"></span>
                  </label>`
            ) : `<span class="guard-sub" style="color:var(--sun);">Pair this device to save it to your account and enable theft guard.</span>`
          }
        </div>

        <div class="umb-actions">
          <button class="action-btn primary-action" onclick="viewOnMap('${escapeHTML(station.device_id)}', ${Number(station.latitude) || 0}, ${Number(station.longitude) || 0})">
            <i class="fas fa-map-marked-alt"></i> View on Map
          </button>
          ${isPaired ? `<button class="action-btn danger-action" onclick="removeCard('card-${station.id}', '${escapeHTML(station.name)}', ${station.id})">
              <i class="fas fa-trash-alt"></i>
            </button>`
            : `<button class="action-btn" onclick="pairLiveDevice('${escapeHTML(station.device_id)}', '${escapeHTML(station.name)}')">
                <i class="fas fa-link"></i> Pair
              </button>`
          }
        </div>
      </div>
    `;
}

function renderSolarBars(value) {
    const bars = [];
    for (let i = 0; i < 6; i += 1) {
        const height = Math.max(18, Math.min(80, value - i * 6));
        bars.push(`<span style="height:${height}px"></span>`);
    }
    return bars.join('');
}

function escapeHTML(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDaysAgo(value) {
    const date = new Date(value);
    const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
}

function timeAgo(value) {
    const date = new Date(value);
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

async function openAddModal() {
    const deviceId = prompt('Enter device ID (use the device MAC-based ID if available, e.g. 24A1B2C3D4E5)');
    if (!deviceId) return;

    const name = prompt('Enter a friendly name for this station', 'E·Shady Station');
    if (!name) return;

    const location = prompt('Enter a location description', 'Beach side');
    try {
        await fetchJSON(`${API_BASE}/stations`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ device_id: deviceId, name, location }),
        });
        toast('Station paired successfully.');
        loadDashboard();
    } catch (err) {
        toast(err.message);
    }
}

function pairLiveDevice(deviceId, suggestedName) {
    const id = prompt('Enter device ID', deviceId);
    if (!id) return;
    const name = prompt('Enter a friendly name for this station', suggestedName || 'E·Shady Station');
    if (!name) return;
    const location = prompt('Enter a location description', 'Beach side');
    fetchJSON(`${API_BASE}/stations`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ device_id: id, name, location }),
    })
        .then(() => {
            toast('Station paired successfully.');
            loadDashboard();
        })
        .catch((err) => toast(err.message));
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
        loadDashboard();
    } catch (err) {
        toast(err.message);
        checkbox.checked = !checkbox.checked;
    }
}

async function removeCard(cardId, stationName, stationId) {
    if (!confirm(`Remove ${stationName} from your account?`)) return;
    try {
        await fetchJSON(`${API_BASE}/stations/${stationId}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });
        const card = document.getElementById(cardId);
        if (card) card.remove();
        toast(`${stationName} removed.`);
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
        loadDashboard();
    } catch (err) {
        toast(err.message);
    }
}

function logout() {
    localStorage.removeItem('eshady_token');
    window.location.href = '/login';
}

async function updateAlertsNavBadge() {
    const badge = document.getElementById('alertsNavBadge');
    if (!badge) return;
    try {
        const payload = await fetch(`${API_BASE}/alerts/zone`).then((r) => r.json());
        const devicesOnline = payload?.devices_online ?? 0;
        const count = devicesOnline > 0 ? (payload?.count ?? payload?.alerts?.length ?? 0) : 0;
        badge.textContent = String(count);
        badge.hidden = count === 0;
    } catch {
        badge.hidden = true;
    }
}

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = e.currentTarget.getAttribute('data-action');
            if (action === 'sign-out') {
                logout();
                return;
            }
            if (action === 'map') {
                window.location.href = '/map';
                return;
            }
<<<<<<< Updated upstream
=======
            if (action === 'alerts') {
                window.location.href = '/alerts';
                return;
            }
            if (action === 'dashboard') {
                window.location.href = '/dashboard';
                return;
            }
>>>>>>> Stashed changes
            toast(`${action.charAt(0).toUpperCase() + action.slice(1)} coming soon.`);
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
    updateAlertsNavBadge();
    setInterval(updateAlertsNavBadge, 5000);

    const connectBtn = document.getElementById('connectUmbrellaBtn');
    if (connectBtn) {
        connectBtn.addEventListener('click', openAddModal);
    }

    window.openAddModal = openAddModal;
});
