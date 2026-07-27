import { registerRootComponent } from 'expo';
import { initExecutorch } from 'react-native-executorch';
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';

import App from './App';

// Must run before any model hook mounts. Tells ExecuTorch how to fetch and
// cache the Kokoro weights (they download on first use, not in the bundle).
// Guarded so the web build (used for UI work in a browser) still boots, where
// there is no native ExecuTorch runtime.
try {
  initExecutorch({ resourceFetcher: ExpoResourceFetcher });
} catch (e) {
  console.warn('ExecuTorch unavailable on this platform:', e && e.message);
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
