// Expo config. Account-specific values come from the environment so this file
// can live in a public repo. Copy .env.example to .env and fill in your own
// identifiers, or export the variables in your shell before running Expo/EAS.
//
// Nothing here is secret: these are identifiers, not credentials. The actual
// signing material (.p8 / .p12 / provisioning profile) is never in this repo.

const bundleId = process.env.APP_BUNDLE_IDENTIFIER || 'com.example.texttotalk';

export default {
  expo: {
    name: process.env.APP_DISPLAY_NAME || 'Text to Talk',
    slug: process.env.EXPO_SLUG || 'text-to-talk',
    // Undefined is fine: Expo falls back to the logged-in account.
    owner: process.env.EXPO_OWNER || undefined,
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'texttotalk',
    userInterfaceStyle: 'dark',
    backgroundColor: '#1E1524',
    splash: {
      backgroundColor: '#1E1524',
      resizeMode: 'contain',
      image: './assets/splash-icon.png',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: bundleId,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: process.env.ANDROID_PACKAGE || bundleId,
      adaptiveIcon: {
        backgroundColor: '#1E1524',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      // We never record audio; suppressing the permission keeps the mic prompt
      // (and the App Review questions that follow it) out of the build.
      ['expo-audio', { microphonePermission: false }],
      'expo-asset',
      // react-native-executorch requires iOS 17+.
      ['expo-build-properties', { ios: { deploymentTarget: '17.0' } }],
    ],
    extra: {
      eas: {
        projectId: process.env.EAS_PROJECT_ID || undefined,
      },
    },
  },
};
