const POLL_INTERVAL = 3000;
const API_ALERTS = "/api/alerts/zone";
const MAP_FOCUS_KEY = "eshady_map_focus";

const dismissedWhileOutside = new Set();

const elStatusDot = document.getElementById("status-dot");
const elStatusLabel = document.getElementById("status-label");
const elAlertCount = document.getElementById("alert-count");
const elMonitoredCount = document.getElementById("monitored-count");
const elDevicesOnlineCount = document.getElementById("devices-online-count");
const elLastChecked = document.getElementById("last-checked");
const elAlertsBadge = document.getElementById("alerts-badge");
const elAlertsList = document.getElementById("alerts-list");
const elAlertsEmpty = document.getElementById("alerts-empty");
const elAlertsSetup = document.getElementById("alerts-setup");

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatCoords(lat, lng) {
  const latStr = `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? "N" : "S"}`;
  const lngStr = `${Math.abs(lng).toFixed(5)}° ${lng >= 0 ? "E" : "W"}`;
  return `${latStr}, ${lngStr}`;
}

function updateHeader(count, hasZones) {
  elStatusDot?.classList.remove("pulse-danger");
  if (!hasZones) {
    if (elStatusLabel) elStatusLabel.textContent = "No zones set";
    return;
  }
  if (count > 0) {
    elStatusDot?.classList.add("pulse-danger");
    if (elStatusLabel) elStatusLabel.textContent = `${count} breach${count === 1 ? "" : "es"}`;
  } else if (elStatusLabel) {
    elStatusLabel.textContent = "All clear";
  }
}

/** Exactly one panel visible: setup | all-clear | active breaches */
function setAlertsPanelState(state) {
  const isSetup = state === "setup";
  const isClear = state === "clear";
  const isBreaches = state === "breaches";

  if (elAlertsSetup) elAlertsSetup.hidden = !isSetup;
  if (elAlertsEmpty) elAlertsEmpty.hidden = !isClear;
  if (elAlertsList) elAlertsList.hidden = !isBreaches;
}

function renderAlertCard(alert) {
  const card = document.createElement("article");
  card.className = "zone-alert-card";
  card.setAttribute("role", "listitem");

  const id = alert.device_id;
  card.innerHTML = `
    <div class="zone-alert-icon" aria-hidden="true"><i class="fas fa-umbrella"></i></div>
    <div class="zone-alert-body">
      <h3 class="zone-alert-title">${escapeHTML(alert.device_name)}</h3>
      <p class="zone-alert-id">${escapeHTML(id)}</p>
      <p class="zone-alert-msg">${escapeHTML(alert.message)}</p>
      <div class="zone-alert-msg" style="margin-top:0.35rem;">
        <span>${Math.round(alert.distance_m)} m away</span> ·
        <span>Limit ${Math.round(alert.radius_m)} m</span>
      </div>
      <div class="zone-alert-msg" style="margin-top:0.25rem;color:rgba(255,255,255,0.85);font-size:0.8rem;">
        ${escapeHTML(formatCoords(alert.latitude, alert.longitude))}
      </div>
    </div>
    <div class="zone-alert-actions">
      <a href="#" class="btn-primary" data-action="view-map">View on map</a>
      <button type="button" class="btn-outline btn-dismiss" data-action="dismiss" style="padding:0.4rem 0.65rem;font-size:0.72rem;">Dismiss</button>
    </div>
  `;

  card.querySelector('[data-action="dismiss"]')?.addEventListener("click", () => {
    dismissedWhileOutside.add(id);
    card.remove();
    refresh();
  });

  card.querySelector('[data-action="view-map"]')?.addEventListener("click", (e) => {
    e.preventDefault();
    sessionStorage.setItem(
      MAP_FOCUS_KEY,
      JSON.stringify({ deviceId: id, lat: alert.latitude, lng: alert.longitude })
    );
    window.location.href = "/map";
  });

  return card;
}

function updateEmptyCopy(devicesOnline) {
  if (!elAlertsEmpty) return;
  const title = elAlertsEmpty.querySelector(".alerts-empty-title");
  const sub = elAlertsEmpty.querySelector(".alerts-empty-sub");
  if (devicesOnline === 0) {
    if (title) title.textContent = "No live devices right now";
    if (sub) sub.textContent = "Safe zones are saved, but nothing is sending GPS. Alerts resume when a device comes online.";
  } else {
    if (title) title.textContent = "All umbrellas are in their safe zones";
    if (sub) sub.textContent = "No devices are outside their configured radius right now.";
  }
}

async function fetchAlerts() {
  const res = await fetch(API_ALERTS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function refresh() {
  try {
    const payload = await fetchAlerts();
    const alerts = payload.alerts || [];
    const hasZones = Boolean(payload.has_zones);
    const devicesOnline = payload.devices_online ?? 0;

    // No live GPS — do not show stale breach cards
    const activeAlerts = devicesOnline > 0
      ? alerts.filter((a) => !dismissedWhileOutside.has(a.device_id))
      : [];

    if (elMonitoredCount) elMonitoredCount.textContent = String(payload.zones_monitored ?? 0);
    if (elDevicesOnlineCount) elDevicesOnlineCount.textContent = String(devicesOnline);
    if (elLastChecked && payload.checked_at) {
      elLastChecked.textContent = new Date(payload.checked_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    if (elAlertCount) elAlertCount.textContent = String(activeAlerts.length);
    if (elAlertsBadge) elAlertsBadge.textContent = String(activeAlerts.length);

    if (elAlertsList) {
      elAlertsList.innerHTML = "";
      activeAlerts.forEach((a) => elAlertsList.appendChild(renderAlertCard(a)));
    }

    if (!hasZones) {
      setAlertsPanelState("setup");
    } else if (activeAlerts.length > 0) {
      setAlertsPanelState("breaches");
    } else {
      updateEmptyCopy(devicesOnline);
      setAlertsPanelState("clear");
    }

    updateHeader(activeAlerts.length, hasZones);
  } catch (err) {
    console.warn("Alerts fetch error:", err);
    if (elStatusLabel) elStatusLabel.textContent = "Connection error";
  }
}

refresh();
setInterval(refresh, POLL_INTERVAL);
