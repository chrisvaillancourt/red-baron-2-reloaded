import { showFatalError, startApp } from './game/app';
import { modules } from './game/modules';

window.addEventListener('error', (e) => showFatalError(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showFatalError(e.reason));

const root = document.getElementById('app')!;
try {
  startApp(root, modules);
} catch (e) {
  showFatalError(e);
}
