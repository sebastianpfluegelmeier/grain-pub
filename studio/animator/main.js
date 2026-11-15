// Entry point of animator/index.html: the animator over IndexedDB.
import {createAnimator} from './animator.js';
import {createIndexedDbBackend} from './store.js';

createAnimator({root: document.body, backend: createIndexedDbBackend()}).catch(error => {
  document.body.textContent = 'The animator could not start: ' + (error?.message || String(error));
});
