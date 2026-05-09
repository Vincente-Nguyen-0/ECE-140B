const API_BASE = '/api';

function showError(message) {
  const errorBanner = document.getElementById('errorMessage');
  const errorText = document.getElementById('errorText');
  if (errorBanner && errorText) {
    errorText.textContent = message;
    errorBanner.style.display = 'flex';
  }
}

function clearError() {
  const errorBanner = document.getElementById('errorMessage');
  if (errorBanner) {
    errorBanner.style.display = 'none';
  }
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || response.statusText || 'Request failed');
  }
  return response.json();
}

async function handleLogin(event) {
  event.preventDefault();
  clearError();

  const email = document.getElementById('email')?.value?.trim();
  const password = document.getElementById('password')?.value?.trim();

  if (!email || !password) {
    showError('Email and password are required.');
    return;
  }

  try {
    const data = await fetchJSON(`${API_BASE}/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem('eshady_token', data.token);
    window.location.href = '/dashboard';
  } catch (error) {
    showError(error.message);
  }
}

async function handleSignup(event) {
  event.preventDefault();
  clearError();

  const firstName = document.getElementById('firstName')?.value?.trim();
  const lastName = document.getElementById('lastName')?.value?.trim();
  const email = document.getElementById('email')?.value?.trim();
  const password = document.getElementById('password')?.value?.trim();

  if (!firstName || !lastName || !email || !password) {
    showError('All fields are required to create an account.');
    return;
  }

  try {
    const data = await fetchJSON(`${API_BASE}/users/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: firstName, last_name: lastName, email, password }),
    });
    localStorage.setItem('eshady_token', data.token);
    window.location.href = '/dashboard';
  } catch (error) {
    showError(error.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('signinForm');
  const signupForm = document.getElementById('signupForm');

  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  if (signupForm) {
    signupForm.addEventListener('submit', handleSignup);
  }
});