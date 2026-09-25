import { installGlobalErrorHandlers, showFatalError, startApp } from './game/app';
import { menuModules } from './game/modules';

installGlobalErrorHandlers();

const root = document.getElementById('app')!;
try {
  startApp(root, menuModules);
} catch (e) {
  showFatalError(e);
}
