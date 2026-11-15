// Dropbox sync (README.md, "Sync with Dropbox"). The app key of the Dropbox
// app is public by design: the sign-in uses PKCE and no secret. With an empty
// key the page shows no sync control and makes no network requests.
export const DROPBOX_APP_KEY = 'pg8vn5gwtn9lpbv';
// The name the Dropbox app was registered with: its files are in
// Dropbox/Apps/<name>. Only shown in the sync panel; when empty, the panel
// names the Apps folder without it.
export const DROPBOX_APP_NAME = '';
