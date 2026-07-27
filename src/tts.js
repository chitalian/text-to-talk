// Native entry point for the on-device neural voice.
// A sibling tts.web.js stubs this out so the web build (used for UI work in a
// browser) can boot without the ExecuTorch native runtime.
export { models, useTextToSpeech, initExecutorch } from 'react-native-executorch';
export { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';
