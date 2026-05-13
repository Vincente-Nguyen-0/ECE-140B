/* ============================================================
   E·SHADY  —  home.js
   JavaScript for index.html (homepage).
   ============================================================ */

/* ──────────────────── PARTICLES ──────────────────── */
/**
 * Spawns floating solar-particle elements inside .sky-canvas.
 * Called once on DOMContentLoaded.
 */
function initParticles() {
  const canvas = document.querySelector('.sky-canvas');
  if (!canvas) return;

  const COUNT = 18;

  for (let i = 0; i < COUNT; i++) {
    const p = document.createElement('div');
    p.className = 'particle';

    const size = Math.random() * 4 + 2;

    p.style.cssText = `
      width:  ${size}px;
      height: ${size}px;
      left:   ${Math.random() * 100}%;
      bottom: ${Math.random() * 20}%;
      animation-duration:  ${6 + Math.random() * 10}s;
      animation-delay:     ${Math.random() * 8}s;
    `;

    canvas.appendChild(p);
  }
}

/* ──────────────────── HEADER SCROLL EFFECT ──────────────────── */
/**
 * Darkens the header background once the user scrolls past 50px.
 * Uses a CSS class so the transition is handled in global.css.
 */
function initHeaderScroll() {
  const header = document.getElementById('header');
  if (!header) return;

  const THRESHOLD = 50;

  function onScroll() {
    if (window.scrollY > THRESHOLD) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // run once on load in case page is pre-scrolled
}

/* ──────────────────── STATION CONNECT ──────────────────── */
/**
 * Adds a new station row to #stationsList when the user clicks Connect.
 * Simulates a brief "Connecting…" state before showing fake live data.
 */
function addStation() {
  const input = document.querySelector('.station-id-row input');
  const list  = document.getElementById('stationsList');

  if (!input || !list) return;

  const id = input.value.trim();
  if (!id) {
    input.focus();
    return;
  }

  // Build the new station row
  const item = document.createElement('div');
  item.className = 'station-item';
  item.style.animation = 'fade-up 0.4s ease both';

  item.innerHTML = `
    <div class="station-info">
      <div class="station-dot" style="background:#2ECC71; box-shadow: 0 0 8px #2ECC71;"></div>
      <div>
        <div class="station-name">E·Shady — ${escapeHTML(id)}</div>
        <div class="station-battery">Connecting…</div>
      </div>
    </div>
    <div class="station-power">--W</div>
  `;

  list.appendChild(item);
  input.value = '';

  // Simulate connection resolving after 1.8 s
  setTimeout(() => {
    const batteryEl = item.querySelector('.station-battery');
    const powerEl   = item.querySelector('.station-power');

    const battery = 30 + Math.floor(Math.random() * 60);
    const watts   = 20 + Math.floor(Math.random() * 60);

    if (batteryEl) batteryEl.textContent = `Battery: ${battery}%`;
    if (powerEl)   powerEl.textContent   = `${watts}W Live`;
  }, 1800);
}

/* ──────────────────── CONTACT FORM ──────────────────── */
/**
 * Handles the contact form submit with a placeholder alert.
 * Replace the alert with a real fetch() call to your backend.
 */
function initContactForm() {
  const form = document.getElementById('contactForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    alert("Message sent! We'll be in touch within 24 hours.");
    form.reset();
  });
}

function initLoginForm() {
  const loginBtn = document.getElementById('loginBtn');
  if (!loginBtn) return;

  loginBtn.addEventListener('click', (e) => {
    e.preventDefault();
    // TODO: Replace with real auth
    alert('Login functionality coming soon!');
  });
}

async function initSignedInHeader() {
  const token = localStorage.getItem('eshady_token');
  if (!token) return;

  try {
    const response = await fetch('/api/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;

    const user = await response.json();
    document.querySelectorAll('.logo, .footer-logo').forEach((link) => {
      link.setAttribute('href', '/dashboard');
    });

    const signInLink = document.querySelector('.btn-signin');
    if (signInLink) {
      signInLink.href = '/dashboard';
      signInLink.textContent = user.email || 'Dashboard';
      signInLink.title = 'Open dashboard';
    }
  } catch (error) {
    console.warn('Unable to load signed-in header state.', error);
  }
}


function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  initHeaderScroll();
  initContactForm();
  initLoginForm();
  initSignedInHeader();
});
