import { installGlobalErrorHandlers, showFatalError, startApp } from './game/app';
import { modules } from './game/modules';

installGlobalErrorHandlers();

const root = document.getElementById('app')!;
try {
  startApp(root, modules);
} catch (e) {
  showFatalError(e);
}
