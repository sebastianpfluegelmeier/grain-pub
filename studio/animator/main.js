// Entry point of animator/index.html: the animator over IndexedDB.
// Selects open Studio's own menu instead of the system's.
import '../dropdowns.js';
import {createAnimator} from './animator.js';
import {createIndexedDbBackend} from './store.js';

createAnimator({root: document.body, backend: createIndexedDbBackend()}).catch(error => {
  document.body.textContent = 'The animator could not start: ' + (error?.message || String(error));
});
