// Selective Shuffle — Pure Client-Side PKCE App

const STORAGE_KEYS = {
  CLIENT_ID: 'qs_spotify_client_id',
  ACCESS_TOKEN: 'qs_access_token',
  REFRESH_TOKEN: 'qs_refresh_token',
  EXPIRES_AT: 'qs_expires_at',
  CODE_VERIFIER: 'qs_pkce_verifier',
  OAUTH_STATE: 'qs_oauth_state',
  PENDING_QUERY: 'qs_pending_query',
  SAVED_COMBOS: 'qs_saved_combos',
  PINNED_COMBOS: 'qs_pinned_combos',
  ARTIST_OVERRIDES: 'qs_artist_overrides',
  REUSABLE_PLAYLIST_ID: 'qs_reusable_playlist_id',
};

const DEFAULT_COMBOS = [];

const SCOPES = [
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
  'playlist-modify-private',
  'playlist-modify-public',
  'playlist-read-private',
  'ugc-image-upload',
].join(' ');

// App State
const state = {
  clientId: localStorage.getItem(STORAGE_KEYS.CLIENT_ID) || '',
  accessToken: localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN) || '',
  refreshToken: localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN) || '',
  expiresAt: Number(localStorage.getItem(STORAGE_KEYS.EXPIRES_AT) || 0),
  userProfile: null,
  devices: [],
  selectedDeviceId: null,
  parsedTokens: [],
  resolvedArtists: new Map(), // tokenLower -> artistObject
  artistCandidates: new Map(), // tokenLower -> artistObject[]
  discographyCache: new Map(), // `${artistId}:${depth}` -> track[]
  currentTracksPool: new Map(), // artistId -> track[]
  shuffledQueue: [],
  totalCatalogCount: 0,
  activeTrackIndex: -1,
  activeSyncedPlaylistId: null,
  isBusy: false,
  artistOverrides: loadJson(STORAGE_KEYS.ARTIST_OVERRIDES, {}),
  savedCombos: loadJson(STORAGE_KEYS.SAVED_COMBOS, DEFAULT_COMBOS),
  pinnedCombos: loadJson(STORAGE_KEYS.PINNED_COMBOS, []),
};

// DOM Elements
const els = {
  brandReset: document.getElementById('brandReset'),
  deviceWrapper: document.getElementById('deviceWrapper'),
  deviceBtn: document.getElementById('deviceBtn'),
  deviceDot: document.getElementById('deviceDot'),
  deviceLabel: document.getElementById('deviceLabel'),
  deviceMenu: document.getElementById('deviceMenu'),
  deviceList: document.getElementById('deviceList'),
  refreshDevicesBtn: document.getElementById('refreshDevicesBtn'),
  authBtn: document.getElementById('authBtn'),
  authDot: document.getElementById('authDot'),
  authLabel: document.getElementById('authLabel'),
  settingsBtn: document.getElementById('settingsBtn'),

  shuffleForm: document.getElementById('shuffleForm'),
  artistInput: document.getElementById('artistInput'),
  clearInputBtn: document.getElementById('clearInputBtn'),
  shuffleBtn: document.getElementById('shuffleBtn'),
  shuffleBtnText: document.getElementById('shuffleBtnText'),
  parsedArtistsBar: document.getElementById('parsedArtistsBar'),

  balanceSelect: document.getElementById('balanceSelect'),
  depthSelect: document.getElementById('depthSelect'),
  limitSelect: document.getElementById('limitSelect'),

  savedCombosSection: document.getElementById('savedCombosSection'),
  savedCombosList: document.getElementById('savedCombosList'),
  showMoreHistoryBtn: document.getElementById('showMoreHistoryBtn'),
  showMoreHistoryLabel: document.getElementById('showMoreHistoryLabel'),
  historyModal: document.getElementById('historyModal'),
  historySheetCard: document.getElementById('historySheetCard'),
  historySheetHandle: document.getElementById('historySheetHandle'),
  historyFullList: document.getElementById('historyFullList'),
  clearAllHistoryBtn: document.getElementById('clearAllHistoryBtn'),
  closeHistoryBtn: document.getElementById('closeHistoryBtn'),

  statusBanner: document.getElementById('statusBanner'),
  statusSpinner: document.getElementById('statusSpinner'),
  statusText: document.getElementById('statusText'),

  resultsSection: document.getElementById('resultsSection'),
  resultsTitle: document.getElementById('resultsTitle'),
  resultsSubtitle: document.getElementById('resultsSubtitle'),
  playNowBtn: document.getElementById('playNowBtn'),
  playNowLabel: document.getElementById('playNowLabel'),
  reshuffleBtn: document.getElementById('reshuffleBtn'),
  playlistMenuBtn: document.getElementById('playlistMenuBtn'),
  playlistMenu: document.getElementById('playlistMenu'),
  overwriteQuickPlaylistBtn: document.getElementById('overwriteQuickPlaylistBtn'),
  createNewPlaylistBtn: document.getElementById('createNewPlaylistBtn'),
  playlistSavedBanner: document.getElementById('playlistSavedBanner'),
  playlistSavedText: document.getElementById('playlistSavedText'),
  openSpotifyAppLink: document.getElementById('openSpotifyAppLink'),
  openSpotifyWebLink: document.getElementById('openSpotifyWebLink'),
  tracklist: document.getElementById('tracklist'),

  artistSwapModal: document.getElementById('artistSwapModal'),
  artistSwapTitle: document.getElementById('artistSwapTitle'),
  artistCandidatesList: document.getElementById('artistCandidatesList'),
  closeArtistSwapBtn: document.getElementById('closeArtistSwapBtn'),

  settingsModal: document.getElementById('settingsModal'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  localhostNotice: document.getElementById('localhostNotice'),
  switchToLoopbackBtn: document.getElementById('switchToLoopbackBtn'),
  clientIdInput: document.getElementById('clientIdInput'),
  redirectUriDisplay: document.getElementById('redirectUriDisplay'),
  copyRedirectBtn: document.getElementById('copyRedirectBtn'),
  copyMobileLinkBtn: document.getElementById('copyMobileLinkBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  saveSettingsOnlyBtn: document.getElementById('saveSettingsOnlyBtn'),
  saveAndConnectBtn: document.getElementById('saveAndConnectBtn'),

  toast: document.getElementById('toast'),
};

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getRedirectUri() {
  let pathname = window.location.pathname.replace(/\/index\.html$/i, '/');
  if (!pathname.endsWith('/')) {
    pathname += '/';
  }
  return window.location.origin + pathname;
}

// Toast helper
let toastTimer = null;
function showToast(msg, duration = 3200) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.add('hidden');
  }, duration);
}

// Status banner helper
function setStatus(message, showSpinner = true) {
  if (!message) {
    els.statusBanner.classList.add('hidden');
    return;
  }
  els.statusText.textContent = message;
  els.statusSpinner.classList.toggle('hidden', !showSpinner);
  els.statusBanner.classList.remove('hidden');
}

// Parse artist query separated by +, &, comma, or " and "
function parseArtistQuery(raw) {
  if (!raw || !raw.trim()) return [];
  const parts = raw
    .split(/\s*(?:\+|,|&|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set();
  const unique = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(part);
    }
  }
  return unique;
}

// PKCE Helpers
function generateRandomString(length = 64) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (x) => possible[x % possible.length]).join('');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const b of bytes) {
    str += String.fromCharCode(b);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function startSpotifyLogin() {
  if (!state.clientId) {
    openSettingsModal();
    showToast('Enter your Spotify Client ID first');
    return;
  }

  const currentQuery = els.artistInput.value.trim();
  if (currentQuery) {
    localStorage.setItem(STORAGE_KEYS.PENDING_QUERY, currentQuery);
  }

  const verifier = generateRandomString(64);
  const hashed = await sha256(verifier);
  const challenge = base64UrlEncode(hashed);
  const oauthState = generateRandomString(32);

  localStorage.setItem(STORAGE_KEYS.CODE_VERIFIER, verifier);
  localStorage.setItem(STORAGE_KEYS.OAUTH_STATE, oauthState);

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', state.clientId);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('state', oauthState);
  authUrl.searchParams.set('redirect_uri', getRedirectUri());

  window.location.href = authUrl.toString();
}

async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem(STORAGE_KEYS.CODE_VERIFIER);
  if (!verifier || !state.clientId) return false;

  const body = new URLSearchParams({
    client_id: state.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: verifier,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || 'Failed to exchange Spotify auth code');
  }

  const data = await res.json();
  saveTokens(data);
  localStorage.removeItem(STORAGE_KEYS.CODE_VERIFIER);
  return true;
}

async function refreshAccessToken() {
  if (!state.refreshToken || !state.clientId) {
    clearTokens();
    return false;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: state.refreshToken,
    client_id: state.clientId,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    clearTokens();
    updateAuthUI();
    return false;
  }

  const data = await res.json();
  saveTokens(data);
  return true;
}

function saveTokens(data) {
  state.accessToken = data.access_token;
  if (data.refresh_token) {
    state.refreshToken = data.refresh_token;
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, data.refresh_token);
  }
  state.expiresAt = Date.now() + (data.expires_in - 60) * 1000;
  localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, state.accessToken);
  localStorage.setItem(STORAGE_KEYS.EXPIRES_AT, String(state.expiresAt));
}

function clearTokens() {
  state.accessToken = '';
  state.refreshToken = '';
  state.expiresAt = 0;
  state.userProfile = null;
  localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.EXPIRES_AT);
}

async function getValidToken() {
  if (!state.accessToken) return '';
  if (Date.now() >= state.expiresAt) {
    const ok = await refreshAccessToken();
    if (!ok) return '';
  }
  return state.accessToken;
}

function isAuthenticated() {
  return Boolean(state.accessToken);
}

// Spotify API Fetch Wrapper with rate-limit & token refresh support
async function spotifyFetch(endpoint, options = {}, retries = 2) {
  const token = await getValidToken();
  if (!token) {
    throw new Error('Not connected to Spotify');
  }

  const url = endpoint.startsWith('http')
    ? endpoint
    : `https://api.spotify.com/v1${endpoint}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 429 && retries > 0) {
    const retryAfter = Number(res.headers.get('Retry-After') || 1);
    await new Promise((r) => setTimeout(r, (retryAfter + 0.5) * 1000));
    return spotifyFetch(endpoint, options, retries - 1);
  }

  if (res.status === 401 && retries > 0) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return spotifyFetch(endpoint, options, retries - 1);
    }
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const msg =
      (data && data.error && data.error.message) ||
      `Spotify API error (${res.status})`;

    // If Spotify rejects a limit parameter, strip limit and retry with Spotify's default page size
    if (res.status === 400 && /invalid limit/i.test(msg) && retries > 0) {
      const retryUrl = new URL(url);
      if (retryUrl.searchParams.has('limit')) {
        retryUrl.searchParams.delete('limit');
        return spotifyFetch(retryUrl.toString(), options, retries - 1);
      }
    }

    const error = new Error(msg);
    error.status = res.status;
    throw error;
  }

  return data;
}

// User Profile & Devices
async function loadUserProfileAndDevices() {
  if (!isAuthenticated()) {
    updateAuthUI();
    return;
  }
  try {
    const [profile] = await Promise.all([
      spotifyFetch('/me'),
      refreshDevices(true),
    ]);
    state.userProfile = profile;
  } catch (err) {
    console.warn('Session check failed:', err);
  }
  updateAuthUI();
}

async function refreshDevices(silent = false) {
  if (!isAuthenticated()) return [];
  try {
    const data = await spotifyFetch('/me/player/devices');
    state.devices = (data && data.devices) || [];

    const active = state.devices.find((d) => d.is_active);
    if (active && !state.selectedDeviceId) {
      state.selectedDeviceId = active.id;
    } else if (
      state.selectedDeviceId &&
      !state.devices.some((d) => d.id === state.selectedDeviceId)
    ) {
      state.selectedDeviceId = active ? active.id : (state.devices[0]?.id || null);
    } else if (!state.selectedDeviceId && state.devices.length > 0) {
      state.selectedDeviceId = state.devices[0].id;
    }

    renderDevicesUI();
    if (!silent) {
      showToast(
        state.devices.length
          ? `Found ${state.devices.length} Spotify device(s)`
          : 'No active Spotify devices found. Open Spotify on your device.'
      );
    }
    return state.devices;
  } catch (err) {
    if (!silent) showToast('Could not fetch devices');
    return [];
  }
}

function renderDevicesUI() {
  if (!isAuthenticated()) {
    els.deviceWrapper.classList.add('hidden');
    return;
  }
  els.deviceWrapper.classList.remove('hidden');

  const chosen =
    state.devices.find((d) => d.id === state.selectedDeviceId) ||
    state.devices.find((d) => d.is_active);

  if (chosen) {
    els.deviceDot.className = 'status-dot connected';
    els.deviceLabel.textContent = chosen.name;
  } else {
    els.deviceDot.className = 'status-dot warn';
    els.deviceLabel.textContent = 'No Active Device';
  }

  els.deviceList.innerHTML = '';
  if (state.devices.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dropdown-item';
    empty.innerHTML = `
      <div class="dropdown-item-title">No Spotify devices awake</div>
      <div class="dropdown-item-desc">Open the Spotify app on your PC, phone, or tablet, then click ↻</div>
    `;
    els.deviceList.appendChild(empty);
    return;
  }

  for (const dev of state.devices) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isSelected = dev.id === state.selectedDeviceId;
    btn.className = `dropdown-item ${isSelected ? 'active-device' : ''}`;
    btn.innerHTML = `
      <div class="dropdown-item-title">
        <span>${escapeHtml(dev.name)}</span>
        ${dev.is_active ? '<span>• Active</span>' : ''}
      </div>
      <div class="dropdown-item-desc">${escapeHtml(dev.type)}</div>
    `;
    btn.addEventListener('click', () => {
      state.selectedDeviceId = dev.id;
      renderDevicesUI();
      els.deviceMenu.classList.add('hidden');
    });
    els.deviceList.appendChild(btn);
  }
}

function updateAuthUI() {
  if (isAuthenticated()) {
    els.authDot.className = 'status-dot connected';
    const name = state.userProfile?.display_name || 'Connected';
    els.authLabel.textContent = name;
    els.logoutBtn.classList.remove('hidden');
    els.deviceWrapper.classList.remove('hidden');
  } else {
    els.authDot.className = 'status-dot';
    els.authLabel.textContent = 'Connect Spotify';
    els.logoutBtn.classList.add('hidden');
    els.deviceWrapper.classList.add('hidden');
  }
}

// Artist Resolution & Disambiguation
let resolveDebounce = null;
function handleInputUpdated() {
  const raw = els.artistInput.value;
  els.clearInputBtn.classList.toggle('hidden', !raw.length);

  state.parsedTokens = parseArtistQuery(raw);
  renderParsedArtistChips();

  clearTimeout(resolveDebounce);
  if (isAuthenticated() && state.parsedTokens.length > 0) {
    resolveDebounce = setTimeout(() => {
      resolveAllTokensLive(state.parsedTokens);
    }, 280);
  }
}

async function resolveAllTokensLive(tokens) {
  await Promise.all(
    tokens.map(async (token) => {
      const lower = token.toLowerCase();
      if (state.resolvedArtists.has(lower)) return;

      if (state.artistOverrides[lower]) {
        state.resolvedArtists.set(lower, state.artistOverrides[lower]);
        renderParsedArtistChips();
      }

      try {
        const data = await spotifyFetch(
          `/search?type=artist&limit=5&q=${encodeURIComponent(token)}`
        );
        const items = data?.artists?.items || [];
        state.artistCandidates.set(lower, items);

        if (!state.resolvedArtists.has(lower) && items.length > 0) {
          // Pick exact case-insensitive name match if available, otherwise first result
          const exact = items.find(
            (a) => a.name.toLowerCase() === lower
          );
          state.resolvedArtists.set(lower, exact || items[0]);
          renderParsedArtistChips();
        }
      } catch {
        // Ignore live preview errors
      }
    })
  );
}

function isMobileDevice() {
  return window.matchMedia('(max-width: 600px), (pointer: coarse)').matches;
}

function appendPlusForNextArtist() {
  const current = els.artistInput.value;
  if (!current || !current.trim()) return;
  const cleaned = current.replace(/[\s+,&]+$/, '').trim();
  if (!cleaned) return;
  els.artistInput.value = `${cleaned} + `;
  handleInputUpdated();
  els.artistInput.focus();
  const len = els.artistInput.value.length;
  try {
    els.artistInput.setSelectionRange(len, len);
  } catch {
    // Ignore if selection range not supported
  }
}

function removeTokenFromInput(tokenToRemove) {
  const remaining = state.parsedTokens.filter(
    (t) => t.toLowerCase() !== tokenToRemove.toLowerCase()
  );
  els.artistInput.value =
    remaining.length > 0
      ? isMobileDevice()
        ? `${remaining.join(' + ')} + `
        : remaining.join(' + ')
      : '';
  handleInputUpdated();
}

function renderParsedArtistChips() {
  els.parsedArtistsBar.innerHTML = '';
  const tokens = state.parsedTokens;
  if (tokens.length === 0) return;

  const depth = els.depthSelect.value;

  tokens.forEach((token, idx) => {
    if (idx > 0) {
      const plus = document.createElement('span');
      plus.className = 'plus-separator';
      plus.textContent = '+';
      els.parsedArtistsBar.appendChild(plus);
    }

    const lower = token.toLowerCase();
    const resolved = state.resolvedArtists.get(lower);
    const chip = document.createElement('div');

    if (resolved) {
      chip.className = 'artist-chip';
      chip.title = 'Tap artist name to switch match, or × to remove';
      const imgUrl =
        resolved.images?.[resolved.images.length - 1]?.url ||
        resolved.images?.[0]?.url ||
        '';
      const cachedTracks = state.discographyCache.get(`${resolved.id}:${depth}`);
      const countBadge = cachedTracks
        ? `<span class="artist-chip-count">${cachedTracks.length}</span>`
        : `<span class="artist-chip-count">▾</span>`;

      chip.innerHTML = `
        <button type="button" class="artist-chip-main">
          ${
            sanitizeImageUrl(imgUrl)
              ? `<img class="artist-chip-avatar" src="${escapeHtml(sanitizeImageUrl(imgUrl))}" alt="" />`
              : `<span class="artist-chip-avatar-placeholder">${escapeHtml(
                  resolved.name.charAt(0)
                )}</span>`
          }
          <span>${escapeHtml(resolved.name)}</span>
          ${countBadge}
        </button>
        <button type="button" class="artist-chip-remove" title="Remove artist" aria-label="Remove">×</button>
      `;
      chip.querySelector('.artist-chip-main').addEventListener('click', () => openArtistSwapModal(token));
      chip.querySelector('.artist-chip-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeTokenFromInput(token);
      });
    } else {
      chip.className = 'artist-chip unmatched';
      chip.innerHTML = `
        <button type="button" class="artist-chip-main">
          <span>${escapeHtml(token)}</span>
        </button>
        <button type="button" class="artist-chip-remove" title="Remove artist" aria-label="Remove">×</button>
      `;
      chip.querySelector('.artist-chip-main').addEventListener('click', () => {
        if (isAuthenticated()) openArtistSwapModal(token);
      });
      chip.querySelector('.artist-chip-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeTokenFromInput(token);
      });
    }

    els.parsedArtistsBar.appendChild(chip);
  });
}

async function openArtistSwapModal(token) {
  const lower = token.toLowerCase();
  els.artistSwapTitle.textContent = `Matches for "${token}"`;
  els.artistCandidatesList.innerHTML = `<div class="dropdown-item-desc" style="padding:8px;">Searching Spotify...</div>`;
  els.artistSwapModal.classList.remove('hidden');

  let candidates = state.artistCandidates.get(lower);
  if (!candidates || candidates.length === 0) {
    try {
      const data = await spotifyFetch(
        `/search?type=artist&limit=8&q=${encodeURIComponent(token)}`
      );
      candidates = data?.artists?.items || [];
      state.artistCandidates.set(lower, candidates);
    } catch (err) {
      els.artistCandidatesList.innerHTML = `<div class="dropdown-item-desc" style="padding:8px;">Could not load artists: ${escapeHtml(
        err.message
      )}</div>`;
      return;
    }
  }

  const current = state.resolvedArtists.get(lower);
  els.artistCandidatesList.innerHTML = '';

  if (candidates.length === 0) {
    els.artistCandidatesList.innerHTML = `<div class="dropdown-item-desc" style="padding:8px;">No matching artists found on Spotify.</div>`;
    return;
  }

  for (const artist of candidates) {
    const item = document.createElement('button');
    item.type = 'button';
    const isSelected = current && current.id === artist.id;
    item.className = `candidate-item ${isSelected ? 'selected' : ''}`;

    const imgUrl =
      artist.images?.[artist.images.length - 1]?.url ||
      artist.images?.[0]?.url ||
      '';
    const followers = artist.followers?.total
      ? `${ Number(artist.followers.total).toLocaleString() } followers`
      : '';
    const genres = (artist.genres || []).slice(0, 2).join(', ');
    const sub = [followers, genres].filter(Boolean).join(' · ') || 'Artist';

    item.innerHTML = `
      ${
        sanitizeImageUrl(imgUrl)
          ? `<img class="candidate-avatar" src="${escapeHtml(sanitizeImageUrl(imgUrl))}" alt="" />`
          : `<span class="artist-chip-avatar-placeholder" style="width:36px;height:36px;">${escapeHtml(
              artist.name.charAt(0)
            )}</span>`
      }
      <div class="candidate-meta">
        <div class="candidate-name">${escapeHtml(artist.name)}</div>
        <div class="candidate-sub">${escapeHtml(sub)}</div>
      </div>
    `;

    item.addEventListener('click', async () => {
      const slimArtist = {
        id: artist.id,
        name: artist.name,
        images: artist.images || [],
        uri: artist.uri,
      };
      state.resolvedArtists.set(lower, slimArtist);
      state.artistOverrides[lower] = slimArtist;
      saveJson(STORAGE_KEYS.ARTIST_OVERRIDES, state.artistOverrides);
      els.artistSwapModal.classList.add('hidden');
      renderParsedArtistChips();

      // If we already have a shuffle open, re-run with the newly selected artist
      if (!els.resultsSection.classList.contains('hidden')) {
        await executeShuffleAndPlay(false);
      }
    });

    els.artistCandidatesList.appendChild(item);
  }
}

// Normalization helper to prevent duplicate songs (e.g. Single version + Album version)
function normalizeTitle(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\s*\((?:feat\.|ft\.|with|remaster|deluxe|bonus|live|explicit|clean)[^)]*\)/gi, '')
    .replace(/\s*-\s*(?:remastered|single|album|mono|stereo|live|version).*$/gi, '')
    .replace(/[^a-z0-9\u00C0-\u024F]+/g, '')
    .trim();
}

// Concurrency helper
async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await fn(items[current], current);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// Helper to fetch multiple pages of Spotify track search in popularity/relevance order
async function fetchRankedSearchTracks(artist, queryStr, offsets) {
  const pages = await mapConcurrent(offsets, 6, async (offset) => {
    try {
      const data = await spotifyFetch(
        `/search?type=track&limit=10&offset=${offset}&q=${encodeURIComponent(queryStr)}`
      );
      return (data?.tracks?.items || [])
        .filter((t) => t.artists?.some((a) => a.id === artist.id) && t.uri)
        .map((t) => formatTrack(t, t.album, artist));
    } catch {
      return [];
    }
  });
  return pages.flat();
}

// Fetch Full Discography / Deep Cuts / Top Tracks for an Artist
async function fetchArtistDiscography(artist, depth, onProgress) {
  const cacheKey = `${artist.id}:${depth}`;
  if (state.discographyCache.has(cacheKey)) {
    return state.discographyCache.get(cacheKey);
  }

  if (depth === 'top') {
    const rankedTracks = [];

    // 1. Seed with /top-tracks if available in the user's Spotify API mode
    try {
      const topData = await spotifyFetch(`/artists/${artist.id}/top-tracks`);
      const seed = (topData?.tracks || [])
        .filter((t) => t.uri)
        .map((t) => formatTrack(t, t.album, artist));
      rankedTracks.push(...seed);
    } catch {
      // Often restricted in Spotify 2026 dev mode; paginated search below handles it
    }

    // 2. Paginate Spotify track search (ordered by popularity/relevance, 10 per page)
    const strictQuery = `artist:"${artist.name}"`;
    const batch1 = await fetchRankedSearchTracks(
      artist,
      strictQuery,
      [0, 10, 20, 30, 40, 50]
    );
    rankedTracks.push(...batch1);
    if (onProgress) onProgress(rankedTracks.length);

    let deduped = deduplicateTracks(rankedTracks);

    // Fetch a second search batch if we need more popular tracks
    if (deduped.length < 65 && batch1.length > 0) {
      const batch2 = await fetchRankedSearchTracks(
        artist,
        strictQuery,
        [60, 70, 80, 90, 100, 110]
      );
      rankedTracks.push(...batch2);
      deduped = deduplicateTracks(rankedTracks);
      if (onProgress) onProgress(deduped.length);
    }

    // If strict artist:"..." filter returned few matches (e.g. punctuation in artist name), search plain name
    if (deduped.length < 35) {
      const broadBatch = await fetchRankedSearchTracks(
        artist,
        artist.name,
        [0, 10, 20, 30, 40, 50]
      );
      rankedTracks.push(...broadBatch);
      deduped = deduplicateTracks(rankedTracks);
    }

    // 3. If search still yielded fewer than 200 unique songs, supplement with interleaved tracks
    // from the artist's singles & albums so queues up to 300 songs always fill up
    if (deduped.length < 200) {
      try {
        let rawReleases = [];
        let nextUrl = `/artists/${artist.id}/albums?include_groups=album,single&limit=10`;
        let pages = 0;
        while (nextUrl && pages < 8) {
          const page = await spotifyFetch(nextUrl);
          if (page?.items) rawReleases.push(...page.items);
          nextUrl = page?.next || null;
          pages++;
        }

        const uniqueReleases = [];
        const seenReleaseNames = new Set();
        for (const rel of rawReleases) {
          const norm = normalizeTitle(rel.name);
          if (!seenReleaseNames.has(norm)) {
            seenReleaseNames.add(norm);
            uniqueReleases.push(rel);
          }
        }

        const releaseTrackBuckets = await mapConcurrent(
          uniqueReleases,
          6,
          async (release) => {
            try {
              const tp = await spotifyFetch(`/albums/${release.id}/tracks`);
              return (tp?.items || [])
                .filter((t) => t.artists?.some((a) => a.id === artist.id) && t.uri)
                .map((t) => formatTrack(t, release, artist));
            } catch {
              return [];
            }
          }
        );

        // Interleave track #1 of each release, then track #2, etc., to favor lead singles & opener hits
        let pos = 0;
        let added = true;
        while (added) {
          added = false;
          for (const bucket of releaseTrackBuckets) {
            if (pos < bucket.length) {
              rankedTracks.push(bucket[pos]);
              added = true;
            }
          }
          pos++;
        }

        deduped = deduplicateTracks(rankedTracks);
      } catch {
        // Keep search tracks if release supplement fails
      }
    }

    state.discographyCache.set(cacheKey, deduped);
    return deduped;
  }

  // Deep cuts: fetch albums & singles (Spotify caps /artists/{id}/albums limit at 10)
  const includeGroups = depth === 'albums' ? 'album' : 'album,single';
  let rawAlbums = [];
  let nextEndpoint = `/artists/${artist.id}/albums?include_groups=${includeGroups}&limit=10`;
  let pageCount = 0;

  while (nextEndpoint && pageCount < 10) {
    const page = await spotifyFetch(nextEndpoint);
    if (page?.items) {
      rawAlbums.push(...page.items);
    }
    nextEndpoint = page?.next || null;
    pageCount++;
  }

  // Deduplicate albums by normalized title so we don't fetch clean + explicit duplicates
  const uniqueAlbums = [];
  const seenAlbumNames = new Set();
  for (const alb of rawAlbums) {
    const norm = normalizeTitle(alb.name);
    if (!seenAlbumNames.has(norm)) {
      seenAlbumNames.add(norm);
      uniqueAlbums.push(alb);
    }
  }

  const collectedTracks = [];

  await mapConcurrent(uniqueAlbums, 6, async (album) => {
    try {
      let trackEndpoint = `/albums/${album.id}/tracks`;
      let trackPages = 0;
      while (trackEndpoint && trackPages < 3) {
        const trackPage = await spotifyFetch(trackEndpoint);
        const items = trackPage?.items || [];
        for (const t of items) {
          // Ensure target artist is credited on this track
          const hasArtist = t.artists?.some((a) => a.id === artist.id);
          if (hasArtist && t.uri) {
            collectedTracks.push(formatTrack(t, album, artist));
          }
        }
        trackEndpoint = trackPage?.next || null;
        trackPages++;
      }
      if (onProgress) onProgress(collectedTracks.length);
    } catch {
      // Continue if an individual album fails
    }
  });

  // Fallback if artist only has guest appearances or empty album list
  if (collectedTracks.length === 0) {
    const searchData = await spotifyFetch(
      `/search?type=track&limit=10&q=${encodeURIComponent(artist.name)}`
    );
    const items = searchData?.tracks?.items || [];
    for (const t of items) {
      if (t.artists?.some((a) => a.id === artist.id)) {
        collectedTracks.push(formatTrack(t, t.album, artist));
      }
    }
  }

  const deduped = deduplicateTracks(collectedTracks);
  state.discographyCache.set(cacheKey, deduped);
  return deduped;
}

function formatTrack(track, album, sourceArtist) {
  const images = album?.images || [];
  const thumb =
    images[images.length - 1]?.url || images[0]?.url || sourceArtist.images?.[0]?.url || '';
  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    duration_ms: track.duration_ms || 0,
    artists: (track.artists || []).map((a) => a.name).join(', '),
    albumName: album?.name || '',
    albumArt: thumb,
    sourceArtistId: sourceArtist.id,
    sourceArtistName: sourceArtist.name,
  };
}

function deduplicateTracks(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    const key = normalizeTitle(t.name) || t.id;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

// Fisher-Yates shuffle
function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Build final shuffled queue according to Mix mode (balanced vs pure random), Depth mode, and Queue limit
function buildShuffledQueue(artistList, tracksByArtistId, balanceMode, limit, depthMode = 'deep') {
  const seenTrackUris = new Set();

  // In 'top' mode, each artist's pool is ordered from most popular to least popular.
  // Harvest round-robin from the top of each artist's ranked list until we have enough
  // top songs to satisfy `limit` (plus a small 15% buffer so Reshuffle stays fresh).
  let effectivePools = tracksByArtistId;
  if (depthMode === 'top') {
    effectivePools = new Map();
    const targetTopPoolSize = Math.ceil(limit * 1.15);
    const topSeenUris = new Set();
    let totalHarvested = 0;
    let rankIdx = 0;

    for (const artist of artistList) {
      effectivePools.set(artist.id, []);
    }

    while (totalHarvested < targetTopPoolSize) {
      let addedInPass = false;
      for (const artist of artistList) {
        const fullRanked = tracksByArtistId.get(artist.id) || [];
        if (rankIdx < fullRanked.length) {
          addedInPass = true;
          const candidate = fullRanked[rankIdx];
          if (!topSeenUris.has(candidate.uri)) {
            topSeenUris.add(candidate.uri);
            effectivePools.get(artist.id).push(candidate);
            totalHarvested++;
            if (totalHarvested >= targetTopPoolSize) break;
          }
        }
      }
      if (!addedInPass) break;
      rankIdx++;
    }
  }

  if (balanceMode === 'random') {
    const all = [];
    for (const artist of artistList) {
      const pool = effectivePools.get(artist.id) || [];
      for (const t of pool) {
        if (!seenTrackUris.has(t.uri)) {
          seenTrackUris.add(t.uri);
          all.push(t);
        }
      }
    }
    return shuffleArray(all).slice(0, limit);
  }

  // Balanced mode: interleave rounds across artists so each artist gets fair play
  const buckets = artistList
    .map((a) => ({
      tracks: shuffleArray(effectivePools.get(a.id) || []),
      cursor: 0,
    }))
    .filter((b) => b.tracks.length > 0);

  const result = [];
  while (result.length < limit) {
    let addedInRound = false;
    // Randomize order of artists within each round for natural variety
    const bucketOrder = shuffleArray(buckets);
    for (const bucket of bucketOrder) {
      while (
        bucket.cursor < bucket.tracks.length &&
        seenTrackUris.has(bucket.tracks[bucket.cursor].uri)
      ) {
        bucket.cursor++;
      }
      if (bucket.cursor < bucket.tracks.length) {
        const candidate = bucket.tracks[bucket.cursor++];
        seenTrackUris.add(candidate.uri);
        result.push(candidate);
        addedInRound = true;
        if (result.length >= limit) break;
      }
    }
    if (!addedInRound) break;
  }

  return result;
}

// Main Orchestrator: Resolve artists -> Harvest discographies -> Shuffle -> Play
async function executeShuffleAndPlay(autoPlay = true) {
  if (state.isBusy) return;

  const rawQuery = els.artistInput.value.trim();
  const tokens = parseArtistQuery(rawQuery);
  if (tokens.length === 0) {
    showToast('Type at least one artist name');
    els.artistInput.focus();
    return;
  }

  if (!isAuthenticated()) {
    startSpotifyLogin();
    return;
  }

  state.isBusy = true;
  els.shuffleBtn.disabled = true;
  els.playlistSavedBanner.classList.add('hidden');

  try {
    setStatus('Matching artists on Spotify...');
    const matchedArtists = [];

    for (const token of tokens) {
      const lower = token.toLowerCase();
      let artist = state.resolvedArtists.get(lower) || state.artistOverrides[lower];

      if (!artist) {
        const data = await spotifyFetch(
          `/search?type=artist&limit=5&q=${encodeURIComponent(token)}`
        );
        const items = data?.artists?.items || [];
        state.artistCandidates.set(lower, items);
        if (items.length > 0) {
          const exact = items.find((a) => a.name.toLowerCase() === lower);
          artist = exact || items[0];
          state.resolvedArtists.set(lower, artist);
        }
      }

      if (artist) {
        matchedArtists.push(artist);
      }
    }

    renderParsedArtistChips();

    if (matchedArtists.length === 0) {
      setStatus('');
      showToast('No matching artists found on Spotify');
      return;
    }

    // Save to recent combos
    saveRecentCombo(matchedArtists.map((a) => a.name.toLowerCase()).join(' + '));

    // Fetch discographies in parallel
    const depth = els.depthSelect.value;
    state.currentTracksPool.clear();
    let totalTracksFound = 0;

    setStatus(
      `Pulling deep cuts for ${matchedArtists.map((a) => a.name).join(' + ')}...`
    );

    await Promise.all(
      matchedArtists.map(async (artist) => {
        const tracks = await fetchArtistDiscography(artist, depth, () => {
          setStatus(`Loading discographies (${matchedArtists.map((a) => a.name).join(' + ')})...`);
        });
        state.currentTracksPool.set(artist.id, tracks);
        totalTracksFound += tracks.length;
      })
    );

    renderParsedArtistChips();

    if (totalTracksFound === 0) {
      setStatus('');
      showToast('Could not find playable tracks for these artists');
      return;
    }

    const limit = Number(els.limitSelect.value) || 80;
    const balanceMode = els.balanceSelect.value;

    state.shuffledQueue = buildShuffledQueue(
      matchedArtists,
      state.currentTracksPool,
      balanceMode,
      limit,
      depth
    );
    state.activeTrackIndex = -1;

    renderResultsSection(matchedArtists, totalTracksFound);
    setStatus('');

    if (autoPlay) {
      await playQueueOnSpotify(0);
    }
  } catch (err) {
    setStatus('');
    showToast(err.message || 'Something went wrong');
  } finally {
    state.isBusy = false;
    els.shuffleBtn.disabled = false;
  }
}

function formatTotalDuration(totalMs) {
  if (!totalMs || totalMs <= 0) return '';
  const totalMinutes = Math.round(totalMs / 60000);
  if (totalMinutes < 60) {
    return `${Math.max(1, totalMinutes)} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
}

function updateResultsSubtitle() {
  const balanceLabel =
    els.balanceSelect.value === 'balanced' ? 'Balanced mix' : 'Pure random';
  const totalMs = state.shuffledQueue.reduce(
    (sum, t) => sum + (Number(t.duration_ms) || 0),
    0
  );
  const durationLabel = formatTotalDuration(totalMs);
  const parts = [
    `${state.shuffledQueue.length} songs`,
    durationLabel,
    balanceLabel,
    `${state.totalCatalogCount} in catalog`,
  ].filter(Boolean);
  els.resultsSubtitle.textContent = parts.join(' · ');
}

function renderResultsSection(artists, totalCatalogCount) {
  state.totalCatalogCount = totalCatalogCount;
  els.resultsSection.classList.remove('hidden');
  els.resultsTitle.textContent = artists.map((a) => a.name).join(' + ');
  updateResultsSubtitle();
  renderTracklist();
}

async function removeTrackFromLiveSpotifyPlaylist(trackUri, wasCurrentlyPlaying) {
  const playlistId =
    state.activeSyncedPlaylistId ||
    localStorage.getItem(STORAGE_KEYS.REUSABLE_PLAYLIST_ID);
  if (!playlistId || !trackUri || !isAuthenticated()) return;

  try {
    try {
      await spotifyFetch(`/playlists/${playlistId}/items`, {
        method: 'DELETE',
        body: JSON.stringify({
          items: [{ uri: trackUri }],
          tracks: [{ uri: trackUri }],
        }),
      });
    } catch {
      await spotifyFetch(`/playlists/${playlistId}/tracks`, {
        method: 'DELETE',
        body: JSON.stringify({
          tracks: [{ uri: trackUri }],
        }),
      });
    }

    if (wasCurrentlyPlaying) {
      await spotifyFetch('/me/player/next', { method: 'POST' }).catch(() => {});
    }
  } catch {
    // Non-fatal background sync
  }
}

function removeTrackAt(idx) {
  const removed = state.shuffledQueue[idx];
  if (!removed) return;

  const wasPlaying = state.activeTrackIndex === idx;
  state.shuffledQueue.splice(idx, 1);

  if (wasPlaying) {
    state.activeTrackIndex =
      idx < state.shuffledQueue.length ? idx : -1;
  } else if (state.activeTrackIndex > idx) {
    state.activeTrackIndex--;
  }

  updateResultsSubtitle();
  renderTracklist();
  removeTrackFromLiveSpotifyPlaylist(removed.uri, wasPlaying);
}

function renderTracklist() {
  els.tracklist.innerHTML = '';

  state.shuffledQueue.forEach((track, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'track-swipe-wrapper';

    const swipeBg = document.createElement('div');
    swipeBg.className = 'track-swipe-bg';
    swipeBg.style.opacity = '0';
    swipeBg.innerHTML = `
      <span class="track-swipe-delete-label">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        <span>Remove</span>
      </span>
    `;

    const row = document.createElement('div');
    row.className = `track-row ${idx === state.activeTrackIndex ? 'playing' : ''}`;
    row.innerHTML = `
      <span class="track-index">${idx === state.activeTrackIndex ? '▶' : idx + 1}</span>
      ${
        sanitizeImageUrl(track.albumArt)
          ? `<img class="track-art" src="${escapeHtml(sanitizeImageUrl(track.albumArt))}" alt="" loading="lazy" />`
          : `<div class="track-art"></div>`
      }
      <div class="track-info">
        <span class="track-name">${escapeHtml(track.name)}</span>
        <span class="track-meta">${escapeHtml(track.artists)}${
      track.albumName ? ` · ${escapeHtml(track.albumName)}` : ''
    }</span>
      </div>
      <div class="track-right">
        <span class="track-duration">${formatDuration(track.duration_ms)}</span>
        <button type="button" class="track-remove-btn" title="Remove from shuffle" aria-label="Remove track">✕</button>
      </div>
    `;

    let didSwipe = false;

    row.addEventListener('click', (e) => {
      if (didSwipe) {
        didSwipe = false;
        return;
      }
      if (e.target.closest('.track-remove-btn')) return;
      playQueueOnSpotify(idx);
    });

    const removeBtn = row.querySelector('.track-remove-btn');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeTrackAt(idx);
    });

    // Mobile right-to-left swipe-to-delete gesture with progressive red background (opacity 0 -> 1)
    let startX = 0;
    let startY = 0;
    let currentDx = 0;
    let isDragging = false;
    let isScrollingVertically = false;

    row.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        currentDx = 0;
        isDragging = false;
        isScrollingVertically = false;
        didSwipe = false;
        row.style.transition = 'none';
        swipeBg.style.transition = 'none';
      },
      { passive: true }
    );

    row.addEventListener(
      'touchmove',
      (e) => {
        if (isScrollingVertically || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;

        if (!isDragging) {
          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) {
            isScrollingVertically = true;
            return;
          }
          if (dx < -8 && Math.abs(dx) > Math.abs(dy)) {
            isDragging = true;
            didSwipe = true;
          } else {
            return;
          }
        }

        if (isDragging) {
          if (e.cancelable) e.preventDefault();
          // Only allow sliding right-to-left (dx <= 0)
          currentDx = Math.min(0, dx);
          const rowWidth = row.offsetWidth || 320;
          const deleteThreshold = Math.min(130, rowWidth * 0.35);
          const progress = Math.min(1, Math.abs(currentDx) / deleteThreshold);

          row.style.transform = `translate3d(${currentDx}px, 0, 0)`;
          row.style.backgroundColor = `rgba(255, 75, 75, ${progress.toFixed(3)})`;
          swipeBg.style.opacity = progress.toFixed(3);
        }
      },
      { passive: false }
    );

    const finishSwipe = () => {
      if (!isDragging) return;
      isDragging = false;
      const rowWidth = row.offsetWidth || 320;
      const deleteThreshold = Math.min(130, rowWidth * 0.35);

      if (Math.abs(currentDx) >= deleteThreshold) {
        row.style.transition = 'transform 0.2s ease-out, background-color 0.2s ease-out';
        swipeBg.style.transition = 'opacity 0.2s ease-out';
        row.style.transform = `translate3d(-${rowWidth}px, 0, 0)`;
        row.style.backgroundColor = 'rgba(255, 75, 75, 1)';
        swipeBg.style.opacity = '1';
        setTimeout(() => {
          removeTrackAt(idx);
        }, 190);
      } else {
        row.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.22s ease';
        swipeBg.style.transition = 'opacity 0.22s ease';
        row.style.transform = 'translate3d(0, 0, 0)';
        row.style.backgroundColor = '';
        swipeBg.style.opacity = '0';
        setTimeout(() => {
          didSwipe = false;
        }, 50);
      }
      currentDx = 0;
    };

    row.addEventListener('touchend', finishSwipe, { passive: true });
    row.addEventListener('touchcancel', finishSwipe, { passive: true });

    wrapper.appendChild(swipeBg);
    wrapper.appendChild(row);
    els.tracklist.appendChild(wrapper);
  });
}

// Helper to replace items in a playlist in 100-track batches (supports up to 300+ tracks)
async function replacePlaylistItems(playlistId, uris) {
  const firstBatch = JSON.stringify({ uris: uris.slice(0, 100) });
  try {
    await spotifyFetch(`/playlists/${playlistId}/items`, {
      method: 'PUT',
      body: firstBatch,
    });
  } catch {
    await spotifyFetch(`/playlists/${playlistId}/tracks`, {
      method: 'PUT',
      body: firstBatch,
    });
  }

  // Spotify limits each playlist write request to 100 URIs; append remaining chunks via POST
  for (let i = 100; i < uris.length; i += 100) {
    const chunkPayload = JSON.stringify({ uris: uris.slice(i, i + 100) });
    try {
      await spotifyFetch(`/playlists/${playlistId}/items`, {
        method: 'POST',
        body: chunkPayload,
      });
    } catch {
      await spotifyFetch(`/playlists/${playlistId}/tracks`, {
        method: 'POST',
        body: chunkPayload,
      });
    }
  }
}

// Convert ./icon.png into a base64-encoded JPEG (<= 256 KB) for Spotify playlist cover API
let cachedPlaylistCoverBase64 = null;
let hasShownCoverScopeHint = false;

async function getPlaylistCoverBase64() {
  if (cachedPlaylistCoverBase64) return cachedPlaylistCoverBase64;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);

        let quality = 0.88;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        let base64 = dataUrl.split(',')[1] || '';

        while (base64.length > 240000 && quality > 0.4) {
          quality -= 0.12;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          base64 = dataUrl.split(',')[1] || '';
        }

        cachedPlaylistCoverBase64 = base64;
        resolve(base64);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () =>
      reject(new Error('Failed to load icon.png for playlist cover'));
    img.src = './icon.png';
  });
}

async function uploadPlaylistCoverImage(playlistId) {
  if (!playlistId || !isAuthenticated()) return false;
  const coverKey = `qs_cover_v1_${playlistId}`;
  if (localStorage.getItem(coverKey) === '1') return true;

  try {
    const base64Jpeg = await getPlaylistCoverBase64();
    if (!base64Jpeg) return false;

    await spotifyFetch(`/playlists/${playlistId}/images`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/jpeg',
      },
      body: base64Jpeg,
    });

    localStorage.setItem(coverKey, '1');
    return true;
  } catch (err) {
    if (
      (err.status === 401 || err.status === 403) &&
      !hasShownCoverScopeHint
    ) {
      hasShownCoverScopeHint = true;
      showToast(
        'Tip: Reconnect Spotify in Settings once to grant playlist cover image permission',
        4500
      );
    }
    return false;
  }
}

// Helper to get or create & populate the single reusable "Selective Shuffle" playlist
async function syncReusablePlaylist(uris) {
  if (!state.userProfile) {
    state.userProfile = await spotifyFetch('/me');
  }

  const artistNames = els.resultsTitle.textContent || 'Selective Shuffle';
  let playlistId = localStorage.getItem(STORAGE_KEYS.REUSABLE_PLAYLIST_ID);
  let existingName = '';

  if (playlistId) {
    try {
      const existing = await spotifyFetch(
        `/playlists/${playlistId}?fields=id,name`
      );
      existingName = existing?.name || '';
    } catch {
      playlistId = null;
    }
  }

  if (!playlistId) {
    try {
      const myPlaylists = await spotifyFetch('/me/playlists?limit=10');
      const found = (myPlaylists?.items || []).find(
        (p) =>
          p.name === 'Selective Shuffle' ||
          p.name === 'Selective Shuffle ⚡' ||
          p.name === 'Quick Shuffle ⚡'
      );
      if (found) {
        playlistId = found.id;
        existingName = found.name || '';
        localStorage.setItem(STORAGE_KEYS.REUSABLE_PLAYLIST_ID, playlistId);
      }
    } catch {
      // Ignore and create new
    }
  }

  if (!playlistId) {
    const created = await spotifyFetch('/me/playlists', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Selective Shuffle',
        description: `Shuffled mix of ${artistNames} (generated by Selective Shuffle)`,
        public: false,
      }),
    });
    playlistId = created.id;
    localStorage.setItem(STORAGE_KEYS.REUSABLE_PLAYLIST_ID, playlistId);
  } else {
    await spotifyFetch(`/playlists/${playlistId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Selective Shuffle',
        description: `Shuffled mix of ${artistNames} (generated by Selective Shuffle)`,
      }),
    }).catch(() => {});
  }

  await replacePlaylistItems(playlistId, uris);
  await uploadPlaylistCoverImage(playlistId);
  state.activeSyncedPlaylistId = playlistId;
  return playlistId;
}

// Direct Playback via Spotify Connect
async function playQueueOnSpotify(startIndex = 0) {
  if (state.shuffledQueue.length === 0) return;

  try {
    setStatus('Starting playback on Spotify...');
    await refreshDevices(true);

    const targetDevice =
      state.devices.find((d) => d.id === state.selectedDeviceId) ||
      state.devices.find((d) => d.is_active) ||
      state.devices[0] ||
      null;

    const targetDeviceId = targetDevice?.id || null;
    const uris = state.shuffledQueue.map((t) => t.uri);

    if (!targetDeviceId) {
      setStatus('');
      showToast(
        'No active Spotify device detected — opening in Spotify app...'
      );
      await saveOrUpdatePlaylist(true);
      return;
    }

    // If the target device is not currently active, wake it up via transfer playback
    if (!targetDevice.is_active) {
      try {
        await spotifyFetch('/me/player', {
          method: 'PUT',
          body: JSON.stringify({
            device_ids: [targetDeviceId],
            play: false,
          }),
        });
        await new Promise((r) => setTimeout(r, 350));
      } catch {
        // Non-fatal
      }
    }

    // Turn off Spotify's internal shuffle so our custom balanced order plays sequentially
    try {
      await spotifyFetch(
        `/me/player/shuffle?state=false&device_id=${encodeURIComponent(targetDeviceId)}`,
        { method: 'PUT' }
      );
    } catch {
      // Ignore if device restricts shuffle state changes
    }

    // Sync reusable playlist and play via context_uri (avoids Spotify Desktop 2026 raw uris silent bug)
    let playedViaContext = false;
    try {
      const playlistId = await syncReusablePlaylist(uris);
      await spotifyFetch(
        `/me/player/play?device_id=${encodeURIComponent(targetDeviceId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            context_uri: `spotify:playlist:${playlistId}`,
            offset: { position: startIndex },
            position_ms: 0,
          }),
        }
      );
      playedViaContext = true;

      // Also expose quick links in case user wants to jump to the app
      const appUri = `spotify:playlist:${playlistId}`;
      const webUrl = `https://open.spotify.com/playlist/${playlistId}`;
      els.playlistSavedText.textContent = `Playing on ${targetDevice.name}`;
      els.openSpotifyAppLink.href = appUri;
      els.openSpotifyWebLink.href = webUrl;
      els.playlistSavedBanner.classList.remove('hidden');
    } catch {
      playedViaContext = false;
    }

    // Fallback to raw track URIs if context playback failed
    if (!playedViaContext) {
      const sliceStart = startIndex >= 100 ? startIndex : 0;
      const offsetPos = startIndex >= 100 ? 0 : startIndex;
      await spotifyFetch(
        `/me/player/play?device_id=${encodeURIComponent(targetDeviceId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            uris: uris.slice(sliceStart, sliceStart + 100),
            offset: { position: offsetPos },
            position_ms: 0,
          }),
        }
      );
    }

    state.activeTrackIndex = startIndex;
    renderTracklist();
    setStatus('');

    showToast(`Playing on ${targetDevice.name}`);
  } catch (err) {
    setStatus('');
    if (err.status === 403 || err.status === 404) {
      showToast(
        'Opening Selective Shuffle playlist in Spotify...'
      );
      await saveOrUpdatePlaylist(true);
    } else {
      showToast(err.message || 'Could not start playback');
    }
  }
}

// Save or Overwrite Reusable Playlist
async function saveOrUpdatePlaylist(reusable = true) {
  if (state.shuffledQueue.length === 0) return;

  try {
    setStatus(
      reusable
        ? 'Updating "Selective Shuffle" playlist...'
        : 'Creating new Spotify playlist...'
    );

    if (!state.userProfile) {
      state.userProfile = await spotifyFetch('/me');
    }

    const uris = state.shuffledQueue.map((t) => t.uri);
    const artistNames = els.resultsTitle.textContent || 'Selective Shuffle';
    let playlistId = null;

    if (reusable) {
      playlistId = await syncReusablePlaylist(uris);
    } else {
      const name = `Shuffle: ${artistNames}`;
      const description = `Shuffled mix of ${artistNames} (generated by Selective Shuffle)`;
      const created = await spotifyFetch('/me/playlists', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description,
          public: false,
        }),
      });
      playlistId = created.id;
      await replacePlaylistItems(playlistId, uris);
      await uploadPlaylistCoverImage(playlistId);
      state.activeSyncedPlaylistId = playlistId;
    }

    setStatus('');

    const appUri = `spotify:playlist:${playlistId}`;
    const webUrl = `https://open.spotify.com/playlist/${playlistId}`;

    els.playlistSavedText.textContent = reusable
      ? `"Selective Shuffle" updated (${uris.length} songs)`
      : `Saved "${artistNames}" playlist`;
    els.openSpotifyAppLink.href = appUri;
    els.openSpotifyWebLink.href = webUrl;
    els.playlistSavedBanner.classList.remove('hidden');

    showToast('Playlist ready! Opening in Spotify...');
    window.location.href = appUri;
  } catch (err) {
    setStatus('');
    showToast(err.message || 'Could not save playlist');
  }
}

// Saved / Recent Combos (Preview capped at 10 + Pin Favorites + Full History Bottom Sheet)
const HISTORY_PREVIEW_LIMIT = 10;

function isComboPinned(combo) {
  const norm = String(combo || '').trim().toLowerCase();
  return state.pinnedCombos.some((c) => c.toLowerCase() === norm);
}

function getOrderedCombos() {
  const pinnedSet = new Set(state.pinnedCombos.map((c) => c.toLowerCase()));
  const pinnedList = [];
  const unpinnedList = [];

  for (const p of state.pinnedCombos) {
    const lower = p.toLowerCase();
    if (!pinnedList.includes(lower)) {
      pinnedList.push(lower);
    }
  }

  for (const c of state.savedCombos) {
    const lower = c.toLowerCase();
    if (!pinnedSet.has(lower) && !unpinnedList.includes(lower)) {
      unpinnedList.push(lower);
    }
  }

  return [...pinnedList, ...unpinnedList];
}

function togglePinCombo(combo) {
  const norm = combo.trim().toLowerCase();
  if (!norm) return;

  if (isComboPinned(norm)) {
    state.pinnedCombos = state.pinnedCombos.filter(
      (c) => c.toLowerCase() !== norm
    );
  } else {
    state.pinnedCombos = [
      norm,
      ...state.pinnedCombos.filter((c) => c.toLowerCase() !== norm),
    ];
    if (!state.savedCombos.some((c) => c.toLowerCase() === norm)) {
      state.savedCombos.unshift(norm);
      saveJson(STORAGE_KEYS.SAVED_COMBOS, state.savedCombos);
    }
  }

  saveJson(STORAGE_KEYS.PINNED_COMBOS, state.pinnedCombos);
  renderSavedCombos();
  if (!els.historyModal.classList.contains('hidden')) {
    renderFullHistoryList();
  }
}

function saveRecentCombo(comboStr) {
  const norm = comboStr.trim().toLowerCase();
  if (!norm) return;
  state.savedCombos = [
    norm,
    ...state.savedCombos.filter((c) => c.toLowerCase() !== norm),
  ].slice(0, 100);
  saveJson(STORAGE_KEYS.SAVED_COMBOS, state.savedCombos);
  renderSavedCombos();
}

function removeSavedCombo(combo) {
  const norm = combo.trim().toLowerCase();
  state.savedCombos = state.savedCombos.filter((c) => c.toLowerCase() !== norm);
  state.pinnedCombos = state.pinnedCombos.filter((c) => c.toLowerCase() !== norm);
  saveJson(STORAGE_KEYS.SAVED_COMBOS, state.savedCombos);
  saveJson(STORAGE_KEYS.PINNED_COMBOS, state.pinnedCombos);
  renderSavedCombos();
  if (!els.historyModal.classList.contains('hidden')) {
    renderFullHistoryList();
    if (getOrderedCombos().length === 0) {
      closeHistoryModal();
    }
  }
}

function renderSavedCombos() {
  els.savedCombosList.innerHTML = '';
  const ordered = getOrderedCombos();
  const total = ordered.length;

  if (total === 0) {
    els.savedCombosSection.classList.add('hidden');
    els.showMoreHistoryBtn.classList.add('hidden');
    return;
  }

  els.savedCombosSection.classList.remove('hidden');

  const previewItems = ordered.slice(0, HISTORY_PREVIEW_LIMIT);

  for (const combo of previewItems) {
    const pinned = isComboPinned(combo);
    const pill = document.createElement('div');
    pill.className = `combo-pill ${pinned ? 'pinned' : ''}`;
    pill.innerHTML = `
      <button type="button" class="combo-pill-pin" title="${
        pinned ? 'Unpin combo' : 'Pin combo to top'
      }" aria-label="${pinned ? 'Unpin' : 'Pin'}">${pinned ? '★' : '☆'}</button>
      <span class="combo-pill-text">${escapeHtml(combo)}</span>
      <span class="combo-pill-remove" title="Remove from history" role="button" aria-label="Remove">×</span>
    `;

    pill.addEventListener('click', (e) => {
      if (e.target.closest('.combo-pill-pin')) {
        e.stopPropagation();
        togglePinCombo(combo);
        return;
      }
      if (e.target.classList.contains('combo-pill-remove')) {
        e.stopPropagation();
        removeSavedCombo(combo);
        return;
      }
      els.artistInput.value = combo;
      handleInputUpdated();
      executeShuffleAndPlay(true);
    });

    els.savedCombosList.appendChild(pill);
  }

  const extraCount = total - HISTORY_PREVIEW_LIMIT;
  els.showMoreHistoryBtn.classList.remove('hidden');
  els.showMoreHistoryBtn.classList.toggle('has-more-than-limit', extraCount > 0);
  els.showMoreHistoryLabel.textContent =
    extraCount > 0 ? `Show more (+${extraCount})` : `History (${total})`;
}

function renderFullHistoryList() {
  els.historyFullList.innerHTML = '';
  const ordered = getOrderedCombos();

  if (ordered.length === 0) {
    els.historyFullList.innerHTML = `<div class="dropdown-item-desc" style="padding:12px;">No shuffle history yet.</div>`;
    return;
  }

  ordered.forEach((combo) => {
    const pinned = isComboPinned(combo);
    const item = document.createElement('div');
    item.className = `history-sheet-item ${pinned ? 'pinned' : ''}`;
    item.innerHTML = `
      <button type="button" class="history-sheet-pin ${
        pinned ? 'active' : ''
      }" title="${pinned ? 'Unpin favorite' : 'Pin favorite to top'}" aria-label="${
      pinned ? 'Unpin' : 'Pin'
    }">${pinned ? '★' : '☆'}</button>
      <button type="button" class="history-sheet-select">
        <span class="history-sheet-text">${escapeHtml(combo)}</span>
      </button>
      <button type="button" class="history-sheet-delete" title="Remove from history" aria-label="Remove">✕</button>
    `;

    item.querySelector('.history-sheet-pin').addEventListener('click', (e) => {
      e.stopPropagation();
      togglePinCombo(combo);
    });

    item.querySelector('.history-sheet-select').addEventListener('click', () => {
      closeHistoryModal();
      els.artistInput.value = combo;
      handleInputUpdated();
      executeShuffleAndPlay(true);
    });

    item.querySelector('.history-sheet-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      removeSavedCombo(combo);
    });

    els.historyFullList.appendChild(item);
  });
}

function openHistoryModal() {
  renderFullHistoryList();
  els.historyModal.classList.remove('hidden');
  els.historySheetCard.style.transform = '';
  requestAnimationFrame(() => {
    els.historyModal.classList.add('sheet-open');
  });
}

function closeHistoryModal() {
  els.historyModal.classList.remove('sheet-open');
  setTimeout(() => {
    els.historyModal.classList.add('hidden');
    els.historySheetCard.style.transform = '';
  }, 240);
}

// Settings Modal
function openSettingsModal() {
  els.clientIdInput.value = state.clientId;
  els.redirectUriDisplay.textContent = getRedirectUri();

  // Check if user opened via localhost instead of 127.0.0.1
  if (window.location.hostname === 'localhost') {
    els.localhostNotice.classList.remove('hidden');
  } else {
    els.localhostNotice.classList.add('hidden');
  }

  els.settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
  els.settingsModal.classList.add('hidden');
}

// Utility Functions
function formatDuration(ms) {
  if (!ms) return '';
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return /^https:\/\//i.test(url.trim()) ? url.trim() : '';
}

function isValidClientId(id) {
  return /^[a-f0-9]{20,40}$/i.test(String(id || '').trim());
}

// Event Listeners & Initialization
async function init() {
  // Register Service Worker for PWA
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Check URL parameters for OAuth callback or shared Client ID (`?cid=...`)
  const url = new URL(window.location.href);
  const cidParam = url.searchParams.get('cid');
  if (cidParam) {
    const cleanCid = cidParam.trim();
    url.searchParams.delete('cid');
    window.history.replaceState({}, document.title, url.toString());
    if (isValidClientId(cleanCid)) {
      state.clientId = cleanCid;
      localStorage.setItem(STORAGE_KEYS.CLIENT_ID, state.clientId);
      showToast('Spotify Client ID configured from link');
    } else {
      showToast('Invalid Client ID format in link');
    }
  }

  const qParam = url.searchParams.get('q');
  if (qParam) {
    els.artistInput.value = qParam.slice(0, 200);
    url.searchParams.delete('q');
    window.history.replaceState({}, document.title, url.toString());
  }

  const authCode = url.searchParams.get('code');
  const authState = url.searchParams.get('state');
  const authError = url.searchParams.get('error');

  if (authCode || authError) {
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    url.searchParams.delete('error');
    window.history.replaceState({}, document.title, url.toString());

    const expectedState = localStorage.getItem(STORAGE_KEYS.OAUTH_STATE);
    localStorage.removeItem(STORAGE_KEYS.OAUTH_STATE);

    if (authError) {
      showToast(`Spotify auth cancelled: ${authError}`);
    } else if (expectedState && authState !== expectedState) {
      showToast('Security check failed (state mismatch). Please try connecting again.');
    } else if (authCode) {
      try {
        setStatus('Completing Spotify sign-in...');
        await exchangeCodeForToken(authCode);
        setStatus('');
        showToast('Connected to Spotify!');
      } catch (err) {
        setStatus('');
        showToast(err.message || 'Authentication failed');
      }
    }
  }

  // Restore any pending query from before OAuth redirect
  const pendingQuery = localStorage.getItem(STORAGE_KEYS.PENDING_QUERY);
  if (pendingQuery) {
    localStorage.removeItem(STORAGE_KEYS.PENDING_QUERY);
    els.artistInput.value = pendingQuery;
  }

  renderSavedCombos();
  handleInputUpdated();
  updateAuthUI();

  if (isAuthenticated()) {
    await loadUserProfileAndDevices();
    if (pendingQuery) {
      executeShuffleAndPlay(true);
    }
  }

  // Update placeholder & enterkeyhint for mobile so users know Enter adds an artist
  const syncInputHintForDevice = () => {
    if (isMobileDevice()) {
      els.artistInput.placeholder = 'Type artist, tap Enter ↵ to add...';
      els.artistInput.setAttribute('enterkeyhint', 'done');
    } else {
      els.artistInput.placeholder = 'artist 1 + artist 2 + artist 3';
      els.artistInput.setAttribute('enterkeyhint', 'go');
    }
  };
  syncInputHintForDevice();
  window.addEventListener('resize', syncInputHintForDevice);

  // Wire up UI events
  els.artistInput.addEventListener('input', handleInputUpdated);

  // On mobile, tapping the keyboard Enter key adds " + " so you can type the next artist quickly
  els.artistInput.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.keyCode === 13) && isMobileDevice()) {
      e.preventDefault();
      e.stopPropagation();
      appendPlusForNextArtist();
    }
  });

  els.clearInputBtn.addEventListener('click', () => {
    els.artistInput.value = '';
    handleInputUpdated();
    els.artistInput.focus();
  });

  els.shuffleForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (isMobileDevice() && e.submitter !== els.shuffleBtn) {
      appendPlusForNextArtist();
      return;
    }
    executeShuffleAndPlay(true);
  });

  els.reshuffleBtn.addEventListener('click', () => {
    executeShuffleAndPlay(true);
  });

  els.playNowBtn.addEventListener('click', () => {
    playQueueOnSpotify(0);
  });

  els.balanceSelect.addEventListener('change', () => {
    if (state.shuffledQueue.length > 0) {
      executeShuffleAndPlay(false);
    }
  });

  els.depthSelect.addEventListener('change', () => {
    renderParsedArtistChips();
    if (state.shuffledQueue.length > 0) {
      executeShuffleAndPlay(false);
    }
  });

  els.limitSelect.addEventListener('change', () => {
    if (state.shuffledQueue.length > 0) {
      executeShuffleAndPlay(false);
    }
  });

  // Device dropdown
  els.deviceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    els.deviceMenu.classList.toggle('hidden');
    els.playlistMenu.classList.add('hidden');
    if (!els.deviceMenu.classList.contains('hidden')) {
      refreshDevices(true);
    }
  });

  els.refreshDevicesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    refreshDevices(false);
  });

  // Playlist dropdown
  els.playlistMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    els.playlistMenu.classList.toggle('hidden');
    els.deviceMenu.classList.add('hidden');
  });

  els.overwriteQuickPlaylistBtn.addEventListener('click', () => {
    els.playlistMenu.classList.add('hidden');
    saveOrUpdatePlaylist(true);
  });

  els.createNewPlaylistBtn.addEventListener('click', () => {
    els.playlistMenu.classList.add('hidden');
    saveOrUpdatePlaylist(false);
  });

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#deviceWrapper')) {
      els.deviceMenu.classList.add('hidden');
    }
    if (!e.target.closest('.playlist-dropdown-wrapper')) {
      els.playlistMenu.classList.add('hidden');
    }
  });

  // Auth & Settings
  els.authBtn.addEventListener('click', () => {
    if (isAuthenticated()) {
      openSettingsModal();
    } else if (!state.clientId) {
      openSettingsModal();
    } else {
      startSpotifyLogin();
    }
  });

  els.settingsBtn.addEventListener('click', openSettingsModal);
  els.closeSettingsBtn.addEventListener('click', closeSettingsModal);
  els.settingsModal.addEventListener('click', (e) => {
    if (e.target === els.settingsModal) closeSettingsModal();
  });

  els.closeArtistSwapBtn.addEventListener('click', () => {
    els.artistSwapModal.classList.add('hidden');
  });
  els.artistSwapModal.addEventListener('click', (e) => {
    if (e.target === els.artistSwapModal) {
      els.artistSwapModal.classList.add('hidden');
    }
  });

  // History Bottom Sheet Modal events
  els.showMoreHistoryBtn.addEventListener('click', openHistoryModal);
  els.closeHistoryBtn.addEventListener('click', closeHistoryModal);
  els.historyModal.addEventListener('click', (e) => {
    if (e.target === els.historyModal) closeHistoryModal();
  });

  els.clearAllHistoryBtn.addEventListener('click', () => {
    const pinnedSet = new Set(state.pinnedCombos.map((c) => c.toLowerCase()));
    const hasUnpinned = state.savedCombos.some(
      (c) => !pinnedSet.has(c.toLowerCase())
    );

    if (hasUnpinned && state.pinnedCombos.length > 0) {
      state.savedCombos = [...state.pinnedCombos];
      saveJson(STORAGE_KEYS.SAVED_COMBOS, state.savedCombos);
      renderSavedCombos();
      renderFullHistoryList();
      showToast('Unpinned history cleared (pinned favorites kept)');
    } else {
      state.savedCombos = [];
      state.pinnedCombos = [];
      saveJson(STORAGE_KEYS.SAVED_COMBOS, state.savedCombos);
      saveJson(STORAGE_KEYS.PINNED_COMBOS, state.pinnedCombos);
      renderSavedCombos();
      closeHistoryModal();
      showToast('History cleared');
    }
  });

  // Drag-down gesture on bottom sheet handle
  let sheetStartY = 0;
  let sheetCurrentDy = 0;
  let sheetDragging = false;

  els.historySheetHandle.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      sheetStartY = e.touches[0].clientY;
      sheetCurrentDy = 0;
      sheetDragging = true;
      els.historySheetCard.style.transition = 'none';
    },
    { passive: true }
  );

  els.historySheetHandle.addEventListener(
    'touchmove',
    (e) => {
      if (!sheetDragging || e.touches.length !== 1) return;
      const dy = Math.max(0, e.touches[0].clientY - sheetStartY);
      sheetCurrentDy = dy;
      els.historySheetCard.style.transform = `translate3d(0, ${dy}px, 0)`;
    },
    { passive: true }
  );

  const endSheetDrag = () => {
    if (!sheetDragging) return;
    sheetDragging = false;
    els.historySheetCard.style.transition = '';
    if (sheetCurrentDy > 80) {
      closeHistoryModal();
    } else {
      els.historySheetCard.style.transform = '';
    }
    sheetCurrentDy = 0;
  };

  els.historySheetHandle.addEventListener('touchend', endSheetDrag, { passive: true });
  els.historySheetHandle.addEventListener('touchcancel', endSheetDrag, { passive: true });

  els.switchToLoopbackBtn.addEventListener('click', () => {
    const newUrl = window.location.href.replace('://localhost', '://127.0.0.1');
    window.location.href = newUrl;
  });

  els.copyRedirectBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(getRedirectUri());
    showToast('Redirect URI copied to clipboard');
  });

  els.copyMobileLinkBtn.addEventListener('click', () => {
    const cid = els.clientIdInput.value.trim() || state.clientId;
    if (!cid) {
      showToast('Paste your Client ID above first');
      return;
    }
    const shareUrl = new URL(getRedirectUri());
    shareUrl.searchParams.set('cid', cid);
    navigator.clipboard.writeText(shareUrl.toString());
    showToast('Phone/Tablet setup link copied!');
  });

  els.saveSettingsOnlyBtn.addEventListener('click', () => {
    state.clientId = els.clientIdInput.value.trim();
    localStorage.setItem(STORAGE_KEYS.CLIENT_ID, state.clientId);
    closeSettingsModal();
    showToast('Settings saved');
  });

  els.saveAndConnectBtn.addEventListener('click', () => {
    state.clientId = els.clientIdInput.value.trim();
    if (!state.clientId) {
      showToast('Please enter your Spotify Client ID');
      return;
    }
    localStorage.setItem(STORAGE_KEYS.CLIENT_ID, state.clientId);
    closeSettingsModal();
    startSpotifyLogin();
  });

  els.logoutBtn.addEventListener('click', () => {
    clearTokens();
    updateAuthUI();
    closeSettingsModal();
    showToast('Disconnected from Spotify');
  });

  els.brandReset.addEventListener('click', () => {
    els.artistInput.focus();
  });
}

init();
