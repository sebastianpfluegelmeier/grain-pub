// A small client for the parts of Dropbox's HTTP API that sync needs: the
// sign-in, listing the app folder's root, and downloading, uploading and
// deleting one file. `fetch` and `storage` are passed in, so tests run
// without a network.
//
// Sign-in is OAuth 2 with PKCE and no client secret (the app key is public)
// and without a redirect URI: Dropbox shows the authorization code and the
// user pastes it into the page. Redirects back into an app added to the Home
// Screen are unreliable on iOS; a pasted code works the same there and in
// Safari. `token_access_type=offline` gives a refresh token, which is kept
// in `storage`; access tokens live in memory only.

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const API_URL = 'https://api.dropboxapi.com/2/';
const CONTENT_URL = 'https://content.dropboxapi.com/2/';
export const TOKEN_KEY = 'animator-dropbox-token';
export const PKCE_KEY = 'animator-dropbox-pkce';
// An access token is replaced this long before Dropbox says it expires, so a
// request never starts with a token that runs out on the way.
const EXPIRY_MARGIN = 5 * 60 * 1000;
const VERIFIER_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

// `kind` tells the caller what to do: 'offline' (no connection or no
// answer), 'auth' (the sign-in is no longer valid), 'conflict', 'not_found',
// 'rate_limit' (wait `retryAfter` seconds) or 'error'.
export class DropboxError extends Error {
  constructor(kind, message, {status = null, retryAfter = null, summary = '', cause} = {}) {
    super(message, cause ? {cause} : undefined);
    this.name = 'DropboxError';
    Object.assign(this, {kind, status, retryAfter, summary});
  }
}

// HTTP headers carry only ASCII, so the JSON in Dropbox-API-Arg escapes every
// character above 0x7E as \uXXXX (UTF-16 units, which JSON reads back).
export function headerSafeJson(value) {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}

function randomVerifier(crypto, length = 64) {
  const values = new Uint8Array(length);
  if (crypto?.getRandomValues) crypto.getRandomValues(values);
  else for (let index = 0; index < length; index++) values[index] = Math.floor(Math.random() * 256);
  return [...values].map(value => VERIFIER_CHARACTERS[value % VERIFIER_CHARACTERS.length]).join('');
}
function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The PKCE pair. S256 needs crypto.subtle, which plain-http origins (a Mac's
// LAN address) do not have; Dropbox accepts the `plain` method there.
export async function createPkce(crypto = globalThis.crypto) {
  const verifier = randomVerifier(crypto);
  if (crypto?.subtle?.digest) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return {verifier, challenge: base64Url(new Uint8Array(digest)), method: 'S256'};
  }
  return {verifier, challenge: verifier, method: 'plain'};
}

async function errorOf(response) {
  let summary = '';
  try {
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      summary = data.error_summary ?? data.error_description ?? (typeof data.error === 'string' ? data.error : text);
    } catch { summary = text; }
  } catch {}
  summary = String(summary ?? '');
  const status = response.status;
  if (status === 401) return new DropboxError('auth', 'Sign in to Dropbox again.', {status, summary});
  if (status === 429) {
    const retryAfter = Number(response.headers?.get?.('Retry-After')) || 60;
    return new DropboxError('rate_limit', `Dropbox asked to wait ${retryAfter} s.`, {status, retryAfter, summary});
  }
  if (status === 409 && /not_found/.test(summary)) return new DropboxError('not_found', 'The file is not in Dropbox.', {status, summary});
  if (status === 409 && /conflict/.test(summary)) return new DropboxError('conflict', 'The file changed in Dropbox.', {status, summary});
  return new DropboxError('error', `Dropbox answered ${status}${summary ? ': ' + summary : ''}`, {status, summary});
}

export function createDropboxClient({appKey, fetch: fetchFn = globalThis.fetch?.bind(globalThis), storage = globalThis.localStorage,
  crypto = globalThis.crypto, now = () => Date.now()}) {
  let access = null, refreshing = null;

  const readJson = key => { try { return JSON.parse(storage?.getItem(key) ?? 'null'); } catch { return null; } };
  const writeJson = (key, value) => { try { storage?.setItem(key, JSON.stringify(value)); } catch {} };
  const forget = key => { try { storage?.removeItem(key); } catch {} };
  const connected = () => Boolean(readJson(TOKEN_KEY)?.refreshToken);

  async function request(url, init) {
    try {
      return await fetchFn(url, init);
    } catch (error) {
      throw new DropboxError('offline', 'Dropbox cannot be reached.', {cause: error});
    }
  }
  const form = values => ({method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(values).toString()});

  async function refreshAccess() {
    const refreshToken = readJson(TOKEN_KEY)?.refreshToken;
    if (!refreshToken) throw new DropboxError('auth', 'Connect Dropbox first.');
    const response = await request(TOKEN_URL, form({grant_type: 'refresh_token', refresh_token: refreshToken, client_id: appKey}));
    if (!response.ok) {
      const error = await errorOf(response);
      // invalid_grant: the refresh token was revoked or the app removed.
      if (response.status === 400 || response.status === 401) throw new DropboxError('auth', 'Sign in to Dropbox again.', {status: response.status, summary: error.summary});
      throw error;
    }
    const data = await response.json();
    access = {token: data.access_token, expires: now() + Number(data.expires_in ?? 14400) * 1000};
    return access.token;
  }
  async function accessToken() {
    if (access && now() < access.expires - EXPIRY_MARGIN) return access.token;
    refreshing ??= refreshAccess().finally(() => { refreshing = null; });
    return refreshing;
  }
  // A request with the access token; a 401 gets one new token and one retry.
  async function authorized(url, init) {
    const send = token => request(url, {...init, headers: {...init.headers, Authorization: 'Bearer ' + token}});
    let response = await send(await accessToken());
    if (response.status === 401) {
      access = null;
      response = await send(await accessToken());
    }
    return response;
  }
  async function rpc(endpoint, argument) {
    const response = await authorized(API_URL + endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(argument)});
    if (!response.ok) throw await errorOf(response);
    return response.json();
  }

  return {
    get connected() { return connected(); },
    // The authorization page's address. The PKCE pair is kept in `storage`
    // until a code is exchanged, because the page may be reloaded while the
    // user is in the Dropbox tab; opening the panel again reuses it.
    async prepareSignIn() {
      let pending = readJson(PKCE_KEY);
      if (!pending?.verifier) {
        pending = await createPkce(crypto);
        writeJson(PKCE_KEY, pending);
      }
      return AUTHORIZE_URL + '?' + new URLSearchParams({client_id: appKey, response_type: 'code', code_challenge: pending.challenge,
        code_challenge_method: pending.method, token_access_type: 'offline'});
    },
    async finishSignIn(code) {
      const pending = readJson(PKCE_KEY), trimmed = String(code ?? '').trim();
      if (!pending?.verifier) throw new DropboxError('auth', 'Tap Connect first, then paste the code Dropbox shows.');
      if (!trimmed) throw new DropboxError('auth', 'Paste the code Dropbox shows.');
      const response = await request(TOKEN_URL, form({code: trimmed, grant_type: 'authorization_code', code_verifier: pending.verifier, client_id: appKey}));
      if (!response.ok) {
        const error = await errorOf(response);
        if (response.status === 400) throw new DropboxError('auth', 'Dropbox did not accept this code. Tap Connect for a new one.', {status: 400, summary: error.summary});
        throw error;
      }
      const data = await response.json();
      if (!data.refresh_token) throw new DropboxError('error', 'Dropbox did not return a refresh token.');
      writeJson(TOKEN_KEY, {refreshToken: data.refresh_token, accountId: data.account_id ?? null});
      access = {token: data.access_token, expires: now() + Number(data.expires_in ?? 14400) * 1000};
      forget(PKCE_KEY);
    },
    // Revokes the token at Dropbox when it can and forgets it either way.
    async disconnect() {
      if (connected()) {
        try { await request(API_URL + 'auth/token/revoke', {method: 'POST', headers: {Authorization: 'Bearer ' + await accessToken()}}); } catch {}
      }
      access = null;
      forget(TOKEN_KEY);forget(PKCE_KEY);
    },
    // Every entry directly in the app folder: [{tag, name, path, rev, size}].
    async list() {
      let page = await rpc('files/list_folder', {path: '', recursive: false, include_deleted: false});
      const entries = [...page.entries];
      while (page.has_more) {
        page = await rpc('files/list_folder/continue', {cursor: page.cursor});
        entries.push(...page.entries);
      }
      return entries.map(entry => ({tag: entry['.tag'], name: entry.name, path: entry.path_display, rev: entry.rev ?? null, size: entry.size ?? null}));
    },
    async download(path) {
      const response = await authorized(CONTENT_URL + 'files/download', {method: 'POST', headers: {'Dropbox-API-Arg': headerSafeJson({path})}});
      if (!response.ok) throw await errorOf(response);
      let result;
      try { result = JSON.parse(response.headers.get('Dropbox-API-Result')); } catch { throw new DropboxError('error', 'Dropbox did not describe the downloaded file.'); }
      return {bytes: new Uint8Array(await response.arrayBuffer()), rev: result.rev, name: result.name};
    },
    // `rev` given: replaces that version of the file; otherwise adds a new
    // file. Either way a newer file in Dropbox answers {conflict: true}
    // instead of being overwritten or renamed.
    async upload(path, bytes, {rev = null} = {}) {
      const mode = rev ? {'.tag': 'update', update: rev} : 'add';
      const response = await authorized(CONTENT_URL + 'files/upload', {method: 'POST',
        headers: {'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': headerSafeJson({path, mode, autorename: false, mute: true})}, body: bytes});
      if (!response.ok) {
        const error = await errorOf(response);
        if (error.kind === 'conflict') return {conflict: true};
        throw error;
      }
      const result = await response.json();
      return {rev: result.rev, name: result.name, path: result.path_display};
    },
    // `rev` given: deletes only that version (Dropbox's parent_rev).
    async remove(path, {rev = null} = {}) {
      await rpc('files/delete_v2', rev ? {path, parent_rev: rev} : {path});
    },
  };
}
