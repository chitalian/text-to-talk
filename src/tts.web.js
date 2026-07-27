// Web stub for the on-device neural voice. There is no ExecuTorch runtime in a
// browser, and importing the real module throws while the bundle is loading, so
// the whole app would go blank. The UI still renders the natural voices; they
// simply never become ready and speech falls back to the Web Speech API.

// Voice config builders are called during render, so every lookup has to answer
// with something callable rather than undefined.
const buildDummy = () => ({});
const languageProxy = new Proxy({}, { get: () => buildDummy });
const kokoroProxy = new Proxy({}, { get: () => languageProxy });

export const models = { text_to_speech: { kokoro: kokoroProxy } };

export const useTextToSpeech = () => ({
  error: null,
  isReady: false,
  isGenerating: false,
  downloadProgress: 0,
  forward: async () => { throw new Error('Natural voice is not available on web'); },
  stream: async () => {},
  streamInsert: () => {},
  streamStop: () => {},
});

export const initExecutorch = () => {};
export const ExpoResourceFetcher = null;
