import { registerRootComponent } from 'expo';
import { initExecutorch, ExpoResourceFetcher } from './src/tts';

import App from './App';

// Must run before any model hook mounts. Tells ExecuTorch how to fetch and
// cache the Kokoro weights (they download on first use, not in the bundle).
// On web this resolves to a no-op stub (see src/tts.web.js).
try {
  initExecutorch({ resourceFetcher: ExpoResourceFetcher });
} catch (e) {
  console.warn('ExecuTorch unavailable on this platform:', e && e.message);
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
