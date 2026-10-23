// Selective Shuffle — Pure Client-Side PKCE App

const STORAGE_KEYS = {
  CLIENT_ID: 'qs_spotify_client_id',
  ACCESS_TOKEN: 'qs_access_token',
  REFRESH_TOKEN: 'qs_refresh_token',
  EXPIRES_AT: 'qs_expires_at',
  CODE_VERIFIER: 'qs_pkce_verifier',
  PENDING_QUERY: 'qs_pending_query',
  SAVED_COMBOS: 'qs_saved_combos',
  ARTIST_OVERRIDES: 'qs_artist_overrides',
  REUSABLE_PLAYLIST_ID: 'qs_reusable_playlist_id',
};

const DEFAULT_COMBOS = [
  'dominic fike + brockhampton + kevin abstract + geezer',
];

const SCOPES = [
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
  'playlist-modify-private',
  'playlist-modify-public',
  'playlist-read-private',
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
  activeTrackIndex: -1,
  isBusy: false,
  artistOverrides: loadJson(STORAGE_KEYS.ARTIST_OVERRIDES, {}),
  savedCombos: loadJson(STORAGE_KEYS.SAVED_COMBOS, DEFAULT_COMBOS),
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

  localStorage.setItem(STORAGE_KEYS.CODE_VERIFIER, verifier);

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', state.clientId);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', challenge);
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
    const chip = document.createElement('button');
    chip.type = 'button';

    if (resolved) {
      chip.className = 'artist-chip';
      chip.title = 'Click to switch if you meant a different artist';
      const imgUrl =
        resolved.images?.[resolved.images.length - 1]?.url ||
        resolved.images?.[0]?.url ||
        '';
      const cachedTracks = state.discographyCache.get(`${resolved.id}:${depth}`);
      const countBadge = cachedTracks
        ? `<span class="artist-chip-count">${cachedTracks.length}</span>`
        : `<span class="artist-chip-count">▾</span>`;

      chip.innerHTML = `
        ${
          imgUrl
            ? `<img class="artist-chip-avatar" src="${escapeHtml(imgUrl)}" alt="" />`
            : `<span class="artist-chip-avatar-placeholder">${escapeHtml(
                resolved.name.charAt(0)
              )}</span>`
        }
        <span>${escapeHtml(resolved.name)}</span>
        ${countBadge}
      `;
      chip.addEventListener('click', () => openArtistSwapModal(token));
    } else {
      chip.className = 'artist-chip unmatched';
      chip.innerHTML = `<span>${escapeHtml(token)}</span>`;
      chip.addEventListener('click', () => {
        if (isAuthenticated()) openArtistSwapModal(token);
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
        imgUrl
          ? `<img class="candidate-avatar" src="${escapeHtml(imgUrl)}" alt="" />`
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

// Fetch Full Discography / Deep Cuts for an Artist
async function fetchArtistDiscography(artist, depth, onProgress) {
  const cacheKey = `${artist.id}:${depth}`;
  if (state.discographyCache.has(cacheKey)) {
    return state.discographyCache.get(cacheKey);
  }

  if (depth === 'top') {
    let tracks = [];
    try {
      const topData = await spotifyFetch(`/artists/${artist.id}/top-tracks`);
      tracks = (topData?.tracks || []).map((t) => formatTrack(t, t.album, artist));
    } catch {
      // Fallback to search if top-tracks endpoint is restricted (max limit is 10)
      const searchData = await spotifyFetch(
        `/search?type=track&limit=10&q=${encodeURIComponent(`artist:"${artist.name}"`)}`
      );
      tracks = (searchData?.tracks?.items || [])
        .filter((t) => t.artists?.some((a) => a.id === artist.id))
        .map((t) => formatTrack(t, t.album, artist));
    }
    const deduped = deduplicateTracks(tracks);
    state.discographyCache.set(cacheKey, deduped);
    return deduped;
  }

  // Deep cuts: fetch albums & singles (Spotify caps /artists/{id}/albums limit at 10)
  const includeGroups = depth === 'albums' ? 'album' : 'album,single';
  let rawAlbums = [];
  let nextEndpoint = `/artists/${artist.id}/albums?include_groups=${includeGroups}&limit=10`;
  let pageCount = 0;

  while (nextEndpoint && pageCount < 6) {
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

// Build final shuffled queue according to Mix mode (balanced vs pure random) and Queue limit
function buildShuffledQueue(artistList, tracksByArtistId, balanceMode, limit) {
  const seenTrackUris = new Set();

  if (balanceMode === 'random') {
    const all = [];
    for (const artist of artistList) {
      const pool = tracksByArtistId.get(artist.id) || [];
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
    .map((a) => shuffleArray(tracksByArtistId.get(a.id) || []))
    .filter((b) => b.length > 0);

  const result = [];
  let round = 0;
  while (result.length < limit) {
    let addedInRound = false;
    // Randomize order of artists within each round for natural variety
    const bucketOrder = shuffleArray(buckets);
    for (const bucket of bucketOrder) {
      if (round < bucket.length) {
        const candidate = bucket[round];
        if (!seenTrackUris.has(candidate.uri)) {
          seenTrackUris.add(candidate.uri);
          result.push(candidate);
          addedInRound = true;
          if (result.length >= limit) break;
        }
      }
    }
    if (!addedInRound) break;
    round++;
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
      limit
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

function renderResultsSection(artists, totalCatalogCount) {
  els.resultsSection.classList.remove('hidden');
  els.resultsTitle.textContent = artists.map((a) => a.name).join(' + ');

  const balanceLabel =
    els.balanceSelect.value === 'balanced' ? 'Balanced mix' : 'Pure random';
  els.resultsSubtitle.textContent = `${state.shuffledQueue.length} songs queued from ${totalCatalogCount} catalog tracks · ${balanceLabel}`;

  renderTracklist();
}

function renderTracklist() {
  els.tracklist.innerHTML = '';

  state.shuffledQueue.forEach((track, idx) => {
    const row = document.createElement('div');
    row.className = `track-row ${idx === state.activeTrackIndex ? 'playing' : ''}`;
    row.innerHTML = `
      <span class="track-index">${idx === state.activeTrackIndex ? '▶' : idx + 1}</span>
      ${
        track.albumArt
          ? `<img class="track-art" src="${escapeHtml(track.albumArt)}" alt="" loading="lazy" />`
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

    row.addEventListener('click', (e) => {
      if (e.target.closest('.track-remove-btn')) return;
      playQueueOnSpotify(idx);
    });

    const removeBtn = row.querySelector('.track-remove-btn');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.shuffledQueue.splice(idx, 1);
      if (state.activeTrackIndex === idx) {
        state.activeTrackIndex = -1;
      } else if (state.activeTrackIndex > idx) {
        state.activeTrackIndex--;
      }
      renderTracklist();
    });

    els.tracklist.appendChild(row);
  });
}

// Helper to replace items in a playlist (supports Feb 2026 /items endpoint + legacy /tracks)
async function replacePlaylistItems(playlistId, uris) {
  const payload = JSON.stringify({ uris: uris.slice(0, 100) });
  try {
    await spotifyFetch(`/playlists/${playlistId}/items`, {
      method: 'PUT',
      body: payload,
    });
  } catch {
    await spotifyFetch(`/playlists/${playlistId}/tracks`, {
      method: 'PUT',
      body: payload,
    });
  }
}

// Helper to get or create & populate the single reusable "Selective Shuffle ⚡" playlist
async function syncReusablePlaylist(uris) {
  if (!state.userProfile) {
    state.userProfile = await spotifyFetch('/me');
  }

  const artistNames = els.resultsTitle.textContent || 'Selective Shuffle';
  let playlistId = localStorage.getItem(STORAGE_KEYS.REUSABLE_PLAYLIST_ID);

  if (playlistId) {
    try {
      await spotifyFetch(`/playlists/${playlistId}?fields=id`);
    } catch {
      playlistId = null;
    }
  }

  if (!playlistId) {
    try {
      const myPlaylists = await spotifyFetch('/me/playlists?limit=10');
      const found = (myPlaylists?.items || []).find(
        (p) => p.name === 'Selective Shuffle ⚡' || p.name === 'Quick Shuffle ⚡'
      );
      if (found) {
        playlistId = found.id;
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
        name: 'Selective Shuffle ⚡',
        description: `Shuffled mix of ${artistNames} (generated by Selective Shuffle)`,
        public: false,
      }),
    });
    playlistId = created.id;
    localStorage.setItem(STORAGE_KEYS.REUSABLE_PLAYLIST_ID, playlistId);
  }

  await replacePlaylistItems(playlistId, uris);
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
      await spotifyFetch(
        `/me/player/play?device_id=${encodeURIComponent(targetDeviceId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            uris: uris.slice(0, 100),
            offset: { position: startIndex },
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
    }

    setStatus('');

    const appUri = `spotify:playlist:${playlistId}`;
    const webUrl = `https://open.spotify.com/playlist/${playlistId}`;

    els.playlistSavedText.textContent = reusable
      ? `"Selective Shuffle ⚡" updated (${uris.length} songs)`
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

// Saved / Recent Combos
function saveRecentCombo(comboStr) {
  const norm = comboStr.trim().toLowerCase();
  if (!norm) return;
  state.savedCombos = [
    norm,
    ...state.savedCombos.filter((c) => c.toLowerCase() !== norm),
  ].slice(0, 8);
  saveJson(STORAGE_KEYS.SAVED_COMBOS, state.savedCombos);
  renderSavedCombos();
}

function renderSavedCombos() {
  els.savedCombosList.innerHTML = '';
  if (state.savedCombos.length === 0) {
    els.savedCombosSection.classList.add('hidden');
    return;
  }
  els.savedCombosSection.classList.remove('hidden');

  for (const combo of state.savedCombos) {
    const pill = document.createElement('div');
    pill.className = 'combo-pill';
    pill.innerHTML = `
      <span class="combo-pill-text">${escapeHtml(combo)}</span>
      <span class="combo-pill-remove" title="Remove saved combo" role="button">×</span>
    `;

    pill.addEventListener('click', (e) => {
      if (e.target.classList.contains('combo-pill-remove')) {
        e.stopPropagation();
        state.savedCombos = state.savedCombos.filter((c) => c !== combo);
        saveJson(STORAGE_KEYS.SAVED_COMBOS, state.savedCombos);
        renderSavedCombos();
        return;
      }
      els.artistInput.value = combo;
      handleInputUpdated();
      executeShuffleAndPlay(true);
    });

    els.savedCombosList.appendChild(pill);
  }
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
    .replace(/"/g, '&quot;');
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
    state.clientId = cidParam.trim();
    localStorage.setItem(STORAGE_KEYS.CLIENT_ID, state.clientId);
    url.searchParams.delete('cid');
    window.history.replaceState({}, document.title, url.toString());
    showToast('Spotify Client ID configured from link');
  }

  const qParam = url.searchParams.get('q');
  if (qParam) {
    els.artistInput.value = qParam;
    url.searchParams.delete('q');
    window.history.replaceState({}, document.title, url.toString());
  }

  const authCode = url.searchParams.get('code');
  const authError = url.searchParams.get('error');

  if (authCode || authError) {
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    url.searchParams.delete('error');
    window.history.replaceState({}, document.title, url.toString());

    if (authError) {
      showToast(`Spotify auth cancelled: ${authError}`);
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

  // Wire up UI events
  els.artistInput.addEventListener('input', handleInputUpdated);

  els.clearInputBtn.addEventListener('click', () => {
    els.artistInput.value = '';
    handleInputUpdated();
    els.artistInput.focus();
  });

  els.shuffleForm.addEventListener('submit', (e) => {
    e.preventDefault();
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
