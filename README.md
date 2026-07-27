# Text to Talk

An iOS app for people who can't speak. Type a sentence, tap **Speak**, and the
phone says it out loud.

Built for someone recovering from throat pain who needed to say "water please"
without hurting to say it. It works equally well for laryngitis, post-surgical
recovery, selective mutism, or any situation where typing is easier than
talking.

Everything runs on the device. Nothing typed is ever sent anywhere.

## What it does

- **Speak** reads the text box aloud. Enter sends; Shift+Enter makes a newline.
- **Quick phrases** are one tap for the things you say constantly. Add and
  delete your own.
- **History** keeps what you've typed, grouped by day, deduplicated, and
  searchable. Tap any line to say it again. Anything you type often can be
  promoted to a quick phrase.
- **Again** repeats the last thing, for when you weren't heard the first time.
- **Voice settings** pick the voice and tune speed and pitch.

Two design decisions worth calling out, both learned the hard way:

- **History records what you type, not what the app says.** Replays don't create
  rows. Otherwise tapping "Yes" five times buries everything else.
- **Speech plays even when the phone is on silent.** The app claims a playback
  audio session, so the ringer switch doesn't mute the person using it. It ducks
  other audio instead of stopping it.

## Voices

The app has two engines and always keeps a working one.

**Apple system voices** (default). Free, instant, offline, no download. Quality
depends on which voices are installed: iOS ships basic "compact" voices, and
Enhanced/Premium ones are free downloads under
*Settings → Accessibility → Spoken Content → Voices*. The in-app voice picker
ranks by quality, surfacing Premium and Enhanced and burying the novelty voices.
Downloading one Premium voice is the single biggest quality improvement
available and costs nothing.

**Natural voice** (opt-in). [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M),
an 82M-parameter neural TTS model (Apache 2.0), running fully on-device via
[react-native-executorch](https://github.com/software-mansion/react-native-executorch).
Model weights download once on first enable and are cached, so the app binary
stays small. If the model fails to load or errors mid-sentence, the app falls
back to the Apple engine automatically — a communication aid should never go
silent because a neural model hiccuped.

## Running it

Requires Node, an Expo account, and Xcode for device builds.

```bash
npm install
cp .env.example .env      # fill in your own identifiers
npx expo start
```

The natural voice needs a native module, so it does **not** work in Expo Go.
Use a development build:

```bash
npx expo run:ios          # local, needs Xcode + CocoaPods
# or
eas build --platform ios --profile development
```

Apple's system voices work fine in Expo Go if you only want to try the UI.

### Configuration

Account-specific identifiers live in the environment, not the repo. See
[.env.example](.env.example). Nothing in there is a credential — they're
identifiers for your Expo and Apple accounts.

`eas.json` is gitignored for the same reason: its submit block points at your
Apple team, your App Store Connect app, and your API key. Copy the examples and
fill in your own values, keeping the `.p8` key itself outside the repo.

```sh
cp .env.example .env            # Expo and Apple identifiers
cp eas.example.json eas.json    # build and submit profiles
```

One thing that is easy to get wrong: cloud builds never see your `.env`, because
it is gitignored and so never uploaded. Anything `app.config.js` reads has to
exist as an EAS environment variable too, or the build falls back to the
placeholder bundle id and fails to match your provisioning profile.

```sh
eas env:create production --name APP_BUNDLE_IDENTIFIER --value com.you.yourapp \
  --visibility plaintext --scope project
```

## Requirements

- iOS 17+ (required by ExecuTorch; the Apple-voice path alone would work lower)
- Expo SDK 54, React Native 0.81
- Apple Silicon Mac to run it as an iOS-app-on-Mac

## Notes for anyone forking this

If you or someone you love is at risk of losing their voice, look at
**Apple Personal Voice** (*Settings → Accessibility → Personal Voice*). It takes
about 15 minutes of reading prompts plus an overnight on-device training pass,
and it produces a synthetic voice that genuinely sounds like you. Third-party
apps can use it. It has to be recorded while the voice still works, so it's
worth doing early rather than when it's needed.

## License

MIT. See [LICENSE](LICENSE).
