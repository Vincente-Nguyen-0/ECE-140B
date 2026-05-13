const API_BASE = '/api';
let googleInitialized = false;

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

function showOAuthErrorFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('oauth_error');
  if (!error) return;

  const messages = {
    missing_google_client_id: 'Google sign-in is missing GOOGLE_CLIENT_ID on the server.',
    missing_google_client_secret: 'Google sign-in is missing GOOGLE_CLIENT_SECRET on the server.',
  };
  showError(messages[error] || 'Google sign-in is not configured on the server.');
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || response.statusText || 'Request failed');
  }
  return response.json();
}

function initializeGoogleSignIn(retries = 0) {
  if (!window.GOOGLE_CLIENT_ID) {
    return;
  }

  if (window.google?.accounts?.id) {
    if (!googleInitialized) {
      google.accounts.id.initialize({
        client_id: window.GOOGLE_CLIENT_ID,
        callback: handleGoogleCredentialResponse,
        ux_mode: 'popup',
      });
      googleInitialized = true;
    }
    return;
  }

  if (retries < 20) {
    setTimeout(() => initializeGoogleSignIn(retries + 1), 250);
  }
}

function promptGoogleSignIn() {
  window.location.href = '/auth/google';
}

async function handleGoogleCredentialResponse(response) {
  if (!response.credential) {
    showError('Google sign-in failed.');
    return;
  }

  try {
    const data = await fetchJSON(`${API_BASE}/users/google-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    localStorage.setItem('eshady_token', data.token);
    window.location.href = '/dashboard';
  } catch (error) {
    showError(error.message);
  }
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
  if (localStorage.getItem('eshady_token')) {
    document.querySelectorAll('.logo, .card-logo, .footer-logo').forEach((link) => {
      link.setAttribute('href', '/dashboard');
    });
  }
  showOAuthErrorFromQuery();

  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  const googleButton = document.getElementById('googleSignInBtn');
  if (googleButton) {
    googleButton.addEventListener('click', () => {
      promptGoogleSignIn();
    });
  }

  initializeGoogleSignIn();
  window.handleGoogleCredentialResponse = handleGoogleCredentialResponse;
  window.promptGoogleSignIn = promptGoogleSignIn;

  if (signupForm) {
    signupForm.addEventListener('submit', handleSignup);
  }
});

window.addEventListener('load', initializeGoogleSignIn);
