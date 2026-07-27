import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, Platform,
  Modal, StatusBar, SafeAreaView, KeyboardAvoidingView, Switch, Animated, Easing,
  AppState, ActivityIndicator,
} from 'react-native';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { setAudioModeAsync } from 'expo-audio';
import { models, useTextToSpeech } from './src/tts';
import { startStream, playSamples, stopPlayback } from './src/naturalVoice';

/* ---------- palette (from the Out Loud demo) ---------- */
const C = {
  ink: '#1E1524', ink2: '#2A1D33', ink3: '#372745',
  honey: '#F5B461', honeyDim: '#C9904A', rose: '#F2C8D8',
  text: '#F7EFF3', muted: '#A392AE', faint: '#7B6A86',
};

const DEFAULT_PHRASES = [
  'Yes', 'No', 'One second', 'Thank you', 'Can you come here?',
  'Water please', "I'm okay", 'Not right now', 'I love you',
];
const PEEK = 3, PAGE = 15, CAP = 400;
const K = { phrases: 'ttt:phrases', history: 'ttt:history', prefs: 'ttt:prefs' };
const DEFAULT_PREFS = {
  voice: '', rate: 1, pitch: 1, autoclear: true,
  engine: 'system',   // 'system' = Apple voices, 'natural' = on-device Kokoro
  natVoice: 'heart',
};

// Kokoro voices worth offering. Weights download once on first use (~a few
// hundred MB) and are cached, so this stays off until she opts in.
const NAT_VOICES = [
  { id: 'heart',   label: 'Heart',   build: () => models.text_to_speech.kokoro.en_us.heart() },
  { id: 'sarah',   label: 'Sarah',   build: () => models.text_to_speech.kokoro.en_us.sarah() },
  { id: 'river',   label: 'River',   build: () => models.text_to_speech.kokoro.en_us.river() },
  { id: 'emma',    label: 'Emma',    build: () => models.text_to_speech.kokoro.en_gb.emma() },
  { id: 'adam',    label: 'Adam',    build: () => models.text_to_speech.kokoro.en_us.adam() },
  { id: 'michael', label: 'Michael', build: () => models.text_to_speech.kokoro.en_us.michael() },
  { id: 'daniel',  label: 'Daniel',  build: () => models.text_to_speech.kokoro.en_gb.daniel() },
];
const natVoiceById = (id) => NAT_VOICES.find((v) => v.id === id) || NAT_VOICES[0];

// iOS's speech engine treats ~0.5 as a normal reading pace; web/Android use 1.0.
const RATE_NORMAL = Platform.OS === 'ios' ? 0.5 : 1.0;

// Speech follows the ringer/silent switch unless the app claims a playback
// audio session. She should be heard with the phone on mute, so claim one.
// allowsRecording must stay false: it forces playAndRecord, which is quieter
// and can route to the earpiece.
const applyAudioMode = () =>
  setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
    allowsRecording: false,
    shouldPlayInBackground: false,
  }).catch(() => {});

/* ---------- voice quality ranking ---------- */
const NOVELTY = /(albert|bad ?news|bahh|bells|boing|bubbles|cellos|deranged|good ?news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|kathy|princess|bruce|agnes|victoria|grandma|grandpa|eddy|flo|rocko|sandy|shelley|hysterical|reed|rishi|eloquence)/i;
function scoreVoice(v) {
  const id = (v.identifier || '').toLowerCase();
  const n = (v.name || '').toLowerCase();
  let s = 0;
  if (/premium/.test(id)) s += 100;
  if (/enhanced/.test(id) || v.quality === 'Enhanced') s += 85;
  if (/siri/.test(id)) s += 70;
  if (/neural/.test(id)) s += 50;
  if (/\b(ava|samantha|zoe|allison|serena|karen|moira|tessa|nicky|evan|nathan|joelle|susan)\b/.test(n)) s += 32;
  if (/compact/.test(id)) s -= 30;
  if (NOVELTY.test(n) || NOVELTY.test(id)) s -= 200;
  if (/^en[-_]us/i.test(v.language || '')) s += 6;
  else if (/^en/i.test(v.language || '')) s += 3;
  return s;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Each line becomes its own sentence. Collapsing newlines into plain spaces
// ran the lines together with no pause, so a list read as one long breath.
const polish = (t) =>
  t
    .replace(/\.{3,}/g, ', ')
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .map((line) => (/[.!?,;:]$/.test(line) ? line : line + '.'))
    .join(' ')
    .trim();

const cleanName = (v) => (v.name || 'Voice').replace(/\s*\((enhanced|premium|compact)\)/i, '');

/* ---------- storage helpers ---------- */
async function jget(key, fallback) {
  try { const r = await AsyncStorage.getItem(key); return r ? JSON.parse(r) : fallback; }
  catch { return fallback; }
}
const jset = (key, val) => AsyncStorage.setItem(key, JSON.stringify(val)).catch(() => {});

/* ================================================================= */
export default function App() {
  const [phrases, setPhrases] = useState(DEFAULT_PHRASES);
  const [history, setHistory] = useState([]);        // [{t, ts, n}] newest first
  const [prefs, setPrefs] = useState({ voice: '', rate: 1, pitch: 1, autoclear: true });
  const [voices, setVoices] = useState([]);          // ranked
  const [text, setText] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [ready, setReady] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [howtoOpen, setHowtoOpen] = useState(false);
  const [voiceModal, setVoiceModal] = useState(false);
  const [editChips, setEditChips] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newPhrase, setNewPhrase] = useState('');
  const [histExpanded, setHistExpanded] = useState(false);
  const [histEditing, setHistEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [armDelete, setArmDelete] = useState(false);
  const [armReset, setArmReset] = useState(false);
  const [natFallback, setNatFallback] = useState(null);   // last natural-voice error

  const lastRef = useRef('');
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  /* ---- natural (on-device Kokoro) voice ---- */
  const natOn = prefs.engine === 'natural';
  // Rebuild only when the chosen voice changes; a fresh object every render
  // would make the hook reload the model in a loop.
  const natConfig = useMemo(() => natVoiceById(prefs.natVoice).build(), [prefs.natVoice]);
  const nat = useTextToSpeech(natConfig, { preventLoad: !natOn });
  const natRef = useRef(nat);
  natRef.current = nat;
  // True while weights are downloading or the model is warming up.
  const natBusy = natOn && !nat.isReady && !nat.error;
  // Bumped on every speak(). Generation is async, so a slow utterance that
  // resolves after she has already tapped something else must not play.
  const genRef = useRef(0);

  const logHistory = useCallback((textVal) => {
    setHistory((prev) => {
      const i = prev.findIndex((h) => h.t.toLowerCase() === textVal.toLowerCase());
      let entry;
      const next = prev.slice();
      if (i > -1) { entry = { ...next[i] }; next.splice(i, 1); entry.n = (entry.n || 1) + 1; }
      else entry = { t: textVal, n: 1 };
      entry.t = textVal;
      entry.ts = Date.now();
      const out = [entry, ...next];
      if (out.length > CAP) out.length = CAP;
      return out;
    });
  }, []);

  const speakSystem = useCallback((t) => {
    const pr = prefsRef.current;
    Speech.speak(polish(t), {
      voice: pr.voice || undefined,
      rate: RATE_NORMAL * (pr.rate || 1),
      pitch: pr.pitch || 1,
      useApplicationAudioSession: true,   // use the playback session set above
      onStart: () => setSpeaking(true),
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  }, []);

  // Returns true if the natural voice handled it. Retries rather than giving up
  // on the first hiccup: forward() rejects while a previous utterance is still
  // synthesising, and that was silently dropping every replay to the Apple voice.
  const speakNatural = useCallback(async (t, mine) => {
    const api = natRef.current;
    const pr = prefsRef.current;
    if (!api) return false;

    for (let attempt = 0; attempt < 4; attempt++) {
      if (mine !== genRef.current) return true;   // superseded, not a failure

      if (api.isGenerating) {
        try { api.streamStop(true); } catch {}
        await wait(120);
        continue;
      }
      if (!api.isReady) { await wait(250); continue; }

      const done = () => { if (mine === genRef.current) setSpeaking(false); };

      // Streaming: start playing the first chunk while the rest is still being
      // synthesised. Rendering the whole sentence first is what caused the
      // noticeable pause between tapping Speak and hearing anything.
      try {
        const stream = startStream(done);
        await api.stream({
          text: polish(t),
          speed: pr.rate || 1,
          stopAutomatically: true,
          onNext: (audio) => { if (mine === genRef.current) stream.push(audio); },
          onEnd: () => stream.end(),
        });
        if (mine !== genRef.current) { stopPlayback(); return true; }
        stream.end();     // no-op if onEnd already fired
        setNatFallback(null);
        return true;
      } catch (streamErr) {
        // Some builds may not support streaming; one-shot still beats silence.
        try {
          const audio = await api.forward({ text: polish(t), speed: pr.rate || 1 });
          if (mine !== genRef.current) return true;
          await playSamples(audio, done);
          setNatFallback(null);
          return true;
        } catch (e) {
          setNatFallback(String((e && e.message) || e));
          await wait(150);
        }
      }
    }
    return false;
  }, []);

  const speak = useCallback((raw, log) => {
    const t = (raw || '').trim();
    if (!t) return;
    const pr = prefsRef.current;

    Speech.stop();
    stopPlayback();

    lastRef.current = t;
    if (log) logHistory(t);

    const mine = ++genRef.current;

    if (pr.engine === 'natural') {
      setSpeaking(true);
      speakNatural(t, mine).then((ok) => {
        if (ok || mine !== genRef.current) return;
        setSpeaking(false);
        speakSystem(t);          // genuine failure, so she still gets a voice
      });
      return;
    }
    speakSystem(t);
  }, [logHistory, speakSystem, speakNatural]);

  /* ---- audio session: keep it alive across interruptions ---- */
  useEffect(() => {
    applyAudioMode();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') applyAudioMode();
    });
    return () => sub.remove();
  }, []);

  /* ---- boot ---- */
  useEffect(() => {
    (async () => {
      const [p, h, pr] = await Promise.all([
        jget(K.phrases, DEFAULT_PHRASES),
        jget(K.history, []),
        jget(K.prefs, {}),
      ]);
      const folded = [];
      for (const e of h) {
        const m = folded.find((x) => x.t.toLowerCase() === e.t.toLowerCase());
        if (m) { m.n = (m.n || 1) + (e.n || 1); m.ts = Math.max(m.ts, e.ts); }
        else folded.push({ t: e.t, ts: e.ts, n: e.n || 1 });
      }
      folded.sort((a, b) => b.ts - a.ts);
      setPhrases(Array.isArray(p) && p.length ? p : DEFAULT_PHRASES);
      setHistory(folded);
      setPrefs((prev) => ({ ...prev, ...pr }));
      setReady(true);
    })();
    loadVoices();
  }, []);

  const loadVoices = useCallback(async () => {
    try {
      const all = await Speech.getAvailableVoicesAsync();
      const eng = all.filter((v) => /^en/i.test(v.language || ''));
      // Some platforms report the same voice twice; duplicates collide on the
      // list key and can render or omit rows unpredictably.
      const seen = new Set();
      const list = (eng.length ? eng : all)
        .filter((v) => {
          const k = v.identifier || v.name;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .sort((a, b) => scoreVoice(b) - scoreVoice(a) || (a.name || '').localeCompare(b.name || ''));
      setVoices(list);
      setPrefs((prev) => {
        if (prev.voice && list.some((v) => v.identifier === prev.voice)) return prev;
        const best = list[0];
        return best ? { ...prev, voice: best.identifier } : prev;
      });
    } catch { /* web/simulator may report none */ }
  }, []);

  /* persist */
  useEffect(() => { if (ready) jset(K.phrases, phrases); }, [phrases, ready]);
  useEffect(() => { if (ready) jset(K.history, history); }, [history, ready]);
  useEffect(() => { if (ready) jset(K.prefs, prefs); }, [prefs, ready]);

  const onSpeak = () => {
    if (!text.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    speak(text, true);
    if (prefsRef.current.autoclear) setText('');
  };
  const onAgain = () => speak(lastRef.current || (history[0] && history[0].t) || text, false);

  // Previewing a voice/speed change is more useful on something she actually
  // said than on a canned line. Fall back only when there's no history yet.
  const speakPreview = () =>
    speak(
      lastRef.current || (history[0] && history[0].t) || 'Hi love, this is how I sound.',
      false
    );

  // speak() reads prefsRef, which only syncs on render. Update it inline so the
  // preview uses the voice just tapped rather than the previous one.
  // Picking any voice also decides the engine, so the one list is the single
  // source of truth: an Apple voice switches to the system engine, a natural
  // voice switches to the on-device one.
  const pickVoice = (id) => {
    prefsRef.current = { ...prefsRef.current, voice: id, engine: 'system' };
    setPrefs((p) => ({ ...p, voice: id, engine: 'system' }));
    speakPreview();
  };

  const pickNaturalVoice = (id) => {
    // Changing the voice swaps the loaded model. Starting a second load while
    // one is still in flight crashes the native runtime, so refuse until the
    // current one settles. The row shows its progress while this is true.
    if (natBusy && id !== prefs.natVoice) return;
    if (id === prefs.natVoice && natOn) { if (nat.isReady) speakPreview(); return; }

    stopPlayback();
    genRef.current++;               // abandon anything mid-flight
    prefsRef.current = { ...prefsRef.current, natVoice: id, engine: 'natural' };
    setPrefs((p) => ({ ...p, natVoice: id, engine: 'natural' }));
    // Previewing before the weights are on disk would just play the Apple
    // voice and read as a bug, so wait until it can actually speak.
    if (natRef.current && natRef.current.isReady) speakPreview();
  };

  // Puts voice, speed and pitch back where they started. Deliberately leaves
  // her phrases and history alone: those are her words, not a setting.
  const restoreDefaults = () => {
    const best = voices[0];
    const next = { ...DEFAULT_PREFS, voice: best ? best.identifier : '' };
    prefsRef.current = next;
    setPrefs(next);
    setArmReset(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  };
  const onClear = () => {
    genRef.current++;          // invalidate any in-flight generation
    Speech.stop();
    stopPlayback();
    setSpeaking(false);
    setText('');
  };

  /* ---- quick phrases ---- */
  const tapChip = (p, i) => {
    if (editChips) setPhrases((prev) => prev.filter((_, k) => k !== i));
    else speak(p, false);
  };
  const commitPhrase = () => {
    const t = newPhrase.trim();
    if (!t) { setAdding(false); return; }
    setPhrases((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setNewPhrase('');
  };
  const saveToPhrases = (t) =>
    setPhrases((prev) => (prev.includes(t) ? prev : [...prev, t]));

  /* ---- history ---- */
  const removeHistory = (t) => setHistory((prev) => prev.filter((x) => x.t !== t));
  const wipeHistory = () => {
    setHistory([]); setHistExpanded(false); setHistEditing(false);
    setShown(PAGE); setQuery(''); setArmDelete(false);
  };
  const toggleMore = () => {
    const qv = histExpanded ? query.trim().toLowerCase() : '';
    const total = qv ? history.filter((h) => h.t.toLowerCase().includes(qv)).length : history.length;
    if (!histExpanded) { setHistExpanded(true); setShown(PAGE); }
    else if (shown < total) setShown((x) => x + PAGE);
    else { setHistExpanded(false); setHistEditing(false); setShown(PAGE); setQuery(''); }
  };

  /* ---- pulsing dot while speaking ---- */
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (speaking) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(0);
  }, [speaking]);

  /* ================= derived ================= */
  const selectedVoice = voices.find((v) => v.identifier === prefs.voice);
  const goodVoices = voices.filter((v) => scoreVoice(v) >= 40);
  const currentVoiceLabel = natOn
    ? `${natVoiceById(prefs.natVoice).label} · Natural`
    : selectedVoice ? cleanName(selectedVoice) : 'Default voice';
  const qv = histExpanded ? query.trim().toLowerCase() : '';
  const matches = qv ? history.filter((h) => h.t.toLowerCase().includes(qv)) : history;
  const limit = histExpanded ? shown : PEEK;
  const shownRows = matches.slice(0, limit);
  const remaining = matches.length - shownRows.length;

  const rateLabel = prefs.rate < 0.85 ? 'slower' : prefs.rate > 1.15 ? 'faster' : 'normal';
  const pitchLabel = prefs.pitch < 0.92 ? 'lower' : prefs.pitch > 1.08 ? 'higher' : 'normal';

  return (
    <SafeAreaView style={st.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.ink} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={st.wrap}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* header */}
          <View style={st.header}>
            <View style={st.mark}>
              <Animated.View
                style={[st.dot, speaking && {
                  transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }],
                  opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }),
                }]}
              />
              <Text style={st.h1}>Text to Talk</Text>
            </View>
            <Pressable style={[st.iconBtn, settingsOpen && st.iconBtnOn]} onPress={() => setSettingsOpen((o) => !o)} hitSlop={8}>
              <Text style={[st.gear, settingsOpen && { color: C.ink }]}>☰</Text>
            </Pressable>
          </View>

          {/* settings */}
          {settingsOpen && (
            <View style={st.panel}>
              <View style={st.field}>
                <Text style={st.lbl}>Voice</Text>
                <View style={st.voiceRow}>
                  <Pressable style={st.voicePick} onPress={() => setVoiceModal(true)}>
                    <Text style={st.voicePickText} numberOfLines={1}>{currentVoiceLabel}</Text>
                    <Text style={st.chevron}>▾</Text>
                  </Pressable>
                  <Pressable style={st.prev} onPress={() => speakPreview()}>
                    <Text style={st.prevText}>Hear it</Text>
                  </Pressable>
                </View>

                {natBusy && (
                  <View style={st.natNote}>
                    <View style={st.rowLine}>
                      <Text style={st.natNoteT}>
                        {nat.downloadProgress > 0 && nat.downloadProgress < 1
                          ? `Downloading ${natVoiceById(prefs.natVoice).label}… ${Math.round(nat.downloadProgress * 100)}%`
                          : `Preparing ${natVoiceById(prefs.natVoice).label}…`}
                      </Text>
                      <ActivityIndicator size="small" color={C.honey} />
                    </View>
                    <View style={st.bar}>
                      <View
                        style={[
                          st.barFill,
                          { width: `${Math.max(3, Math.round((nat.downloadProgress || 0) * 100))}%` },
                        ]}
                      />
                    </View>
                    <Text style={st.subtle}>
                      One time, about a minute on Wi-Fi. Apple's voice keeps working meanwhile.
                    </Text>
                  </View>
                )}
                {natOn && nat.error && (
                  <View style={st.natNote}>
                    <Text style={[st.natNoteT, { color: C.rose }]}>
                      This voice could not load. Using Apple's voice.
                    </Text>
                  </View>
                )}
                {natOn && nat.isReady && natFallback && (
                  <View style={st.natNote}>
                    <Text style={[st.natNoteT, { color: C.rose }]}>Fell back to Apple's voice</Text>
                    <Text style={st.subtle}>{natFallback}</Text>
                  </View>
                )}

                <Pressable onPress={() => setHowtoOpen((o) => !o)}>
                  <Text style={st.help}>Sounds robotic? Get a better voice →</Text>
                </Pressable>
                {howtoOpen && <Howto />}
              </View>

              <View style={st.field}>
                <Text style={st.lbl}>Speed — {rateLabel}</Text>
                <Slider
                  minimumValue={0.6} maximumValue={1.4} step={0.05} value={prefs.rate}
                  onValueChange={(v) => setPrefs((p) => ({ ...p, rate: v }))}
                  minimumTrackTintColor={C.honey} maximumTrackTintColor={C.ink3} thumbTintColor={C.honey}
                />
              </View>
              {/* Kokoro has no pitch control, so hide it rather than show a dead slider. */}
              {!natOn && (
                <View style={st.field}>
                  <Text style={st.lbl}>Pitch — {pitchLabel}</Text>
                  <Slider
                    minimumValue={0.7} maximumValue={1.3} step={0.05} value={prefs.pitch}
                    onValueChange={(v) => setPrefs((p) => ({ ...p, pitch: v }))}
                    minimumTrackTintColor={C.honey} maximumTrackTintColor={C.ink3} thumbTintColor={C.honey}
                  />
                </View>
              )}
              <View style={[st.field, st.rowLine]}>
                <Text style={st.switchT}>Clear after speaking</Text>
                <Switch
                  value={prefs.autoclear}
                  onValueChange={(v) => setPrefs((p) => ({ ...p, autoclear: v }))}
                  trackColor={{ false: C.ink3, true: C.honeyDim }}
                  thumbColor={prefs.autoclear ? '#fff' : C.muted}
                  ios_backgroundColor={C.ink3}
                />
              </View>

              <Pressable
                style={st.reset}
                onPress={() => {
                  if (!armReset) {
                    setArmReset(true);
                    setTimeout(() => setArmReset(false), 4000);
                  } else restoreDefaults();
                }}
              >
                <Text style={[st.resetT, armReset && { color: C.rose }]}>
                  {armReset ? 'Tap again to restore defaults' : 'Restore defaults'}
                </Text>
              </Pressable>
              <Text style={st.resetSub}>
                Voice, speed and pitch only. Your phrases and history stay.
              </Text>
            </View>
          )}

          {/* composer */}
          <View style={[st.composer, speaking && st.composerLive]}>
            <TextInput
              style={st.box}
              value={text}
              onChangeText={setText}
              placeholder="Type here…"
              placeholderTextColor={C.faint}
              multiline
              autoCapitalize="sentences"
              keyboardAppearance="dark"
              scrollEnabled
            />
            <View style={st.actions}>
              <Pressable style={({ pressed }) => [st.btn, st.speak, pressed && { opacity: 0.85 }]} onPress={onSpeak}>
                {speaking ? (
                  <View style={st.speakRow}>
                    <ActivityIndicator size="small" color="#241628" />
                    <Text style={st.speakT}>Speaking</Text>
                  </View>
                ) : (
                  <Text style={st.speakT}>Speak</Text>
                )}
              </Pressable>
              <Pressable style={st.btnGhost} onPress={onAgain}>
                <Text style={st.ghostT}>Again</Text>
              </Pressable>
              <Pressable style={st.btnGhost} onPress={onClear}>
                <Text style={st.ghostT}>Clear</Text>
              </Pressable>
            </View>
          </View>

          {/* quick phrases */}
          <View style={st.sec}>
            <View style={st.secHead}>
              <Text style={st.secTitle}>QUICK PHRASES</Text>
              <Pressable onPress={() => setEditChips((e) => !e)} hitSlop={8}>
                <Text style={st.link}>{editChips ? 'Done' : 'Edit'}</Text>
              </Pressable>
            </View>
            <View style={st.chips}>
              {phrases.map((p, i) => (
                <Pressable key={p + i} style={st.chip} onPress={() => tapChip(p, i)}>
                  <Text style={st.chipT}>{p}</Text>
                  {editChips && <View style={st.chipX}><Text style={st.chipXT}>×</Text></View>}
                </Pressable>
              ))}
              {!adding ? (
                <Pressable style={[st.chip, st.chipAdd]} onPress={() => setAdding(true)}>
                  <Text style={[st.chipT, { color: C.muted }]}>+ Add phrase</Text>
                </Pressable>
              ) : (
                <View style={st.chipAddRow}>
                  <TextInput
                    style={st.chipInput}
                    value={newPhrase}
                    onChangeText={setNewPhrase}
                    placeholder="New phrase"
                    placeholderTextColor={C.faint}
                    autoFocus
                    autoCapitalize="sentences"
                    keyboardAppearance="dark"
                    onSubmitEditing={commitPhrase}
                    returnKeyType="done"
                    blurOnSubmit={false}
                  />
                  <Pressable style={st.chipGo} onPress={commitPhrase}>
                    <Text style={st.chipGoT}>Add</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>

          {/* history */}
          <View style={st.sec}>
            <View style={st.secHead}>
              <Text style={st.secTitle}>{histExpanded ? 'HISTORY' : 'JUST SAID'}</Text>
              {histExpanded && history.length > 0 && (
                <Pressable onPress={() => setHistEditing((e) => !e)} hitSlop={8}>
                  <Text style={st.link}>{histEditing ? 'Done' : 'Edit'}</Text>
                </Pressable>
              )}
            </View>

            {histExpanded && history.length > 12 && (
              <TextInput
                style={st.search}
                value={query}
                onChangeText={(v) => { setQuery(v); setShown(PAGE); }}
                placeholder="Search what you've said"
                placeholderTextColor={C.faint}
                keyboardAppearance="dark"
                autoCapitalize="none"
              />
            )}

            <View style={!histExpanded ? st.histCard : null}>
              {shownRows.length === 0 ? (
                <Text style={st.empty}>
                  {history.length
                    ? 'Nothing matches that.'
                    : 'Nothing yet. Everything you say gets saved here so you can tap it again.'}
                </Text>
              ) : (
                <HistoryRows
                  rows={shownRows}
                  expanded={histExpanded}
                  editing={histEditing}
                  onSpeak={(t) => !histEditing && speak(t, false)}
                  onSave={saveToPhrases}
                  onDelete={removeHistory}
                />
              )}
            </View>

            {(remaining > 0 || (histExpanded && matches.length > PEEK)) && (
              <Pressable style={st.more} onPress={toggleMore}>
                <Text style={st.moreT}>
                  {!histExpanded
                    ? `Show earlier (${remaining})`
                    : remaining > 0
                      ? `Show ${Math.min(remaining, PAGE)} more`
                      : 'Show less'}
                </Text>
              </Pressable>
            )}

            {histExpanded && histEditing && history.length > 0 && (
              <Pressable
                onPress={() => {
                  if (!armDelete) { setArmDelete(true); setTimeout(() => setArmDelete(false), 4000); }
                  else wipeHistory();
                }}
              >
                <Text style={[st.link, st.danger, { textAlign: 'center', paddingVertical: 12 }]}>
                  {armDelete ? 'Tap again to delete everything' : 'Delete all history'}
                </Text>
              </Pressable>
            )}
          </View>

          <Text style={st.note}>Rest your throat. I've got the talking covered. ♥</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* voice picker modal */}
      <Modal visible={voiceModal} animationType="slide" transparent onRequestClose={() => setVoiceModal(false)}>
        <View style={st.modalWrap}>
          <Pressable style={st.modalBackdrop} onPress={() => setVoiceModal(false)} />
          <View style={st.sheet}>
            <View style={st.sheetHead}>
              <Text style={st.sheetTitle}>Choose a voice</Text>
              <Pressable onPress={() => setVoiceModal(false)} hitSlop={8}>
                <Text style={st.link}>Done</Text>
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 460 }}>
              <Text style={st.groupLabel}>Natural — on device</Text>
              <Text style={st.groupNote}>
                Warmer and more human. Downloads once the first time, then works offline.
              </Text>
              {NAT_VOICES.map((v) => {
                const on = natOn && prefs.natVoice === v.id;
                const locked = natBusy && !on;   // can't start a second load
                return (
                  <Pressable
                    key={v.id}
                    style={[st.voiceItem, locked && { opacity: 0.35 }]}
                    disabled={locked}
                    onPress={() => pickNaturalVoice(v.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[st.voiceItemT, on && { color: C.honey, fontWeight: '800' }]}>
                        {v.label}
                      </Text>
                      {on && natBusy && (
                        <Text style={st.subtle}>
                          {nat.downloadProgress > 0 && nat.downloadProgress < 1
                            ? `Downloading… ${Math.round(nat.downloadProgress * 100)}%`
                            : 'Preparing…'}
                        </Text>
                      )}
                      {on && nat.isReady && <Text style={st.subtle}>Ready, on this device</Text>}
                    </View>
                    {on && natBusy && <ActivityIndicator size="small" color={C.honey} />}
                    {on && !natBusy && <Text style={st.check}>✓</Text>}
                  </Pressable>
                );
              })}
              {natBusy && (
                <Text style={st.groupNote}>
                  Finishing this download first. The other voices unlock when it's done.
                </Text>
              )}

              {voices.length === 0 && (
                <Text style={[st.empty, { paddingHorizontal: 18 }]}>
                  No system voices found yet. Close this and reopen in a moment.
                </Text>
              )}
              <VoiceGroup
                label="Best on this device"
                list={goodVoices}
                sel={natOn ? null : prefs.voice}
                onPick={pickVoice}
              />
              <VoiceGroup
                label={goodVoices.length ? 'Other voices' : 'Voices'}
                list={voices.filter((v) => scoreVoice(v) < 40)}
                sel={natOn ? null : prefs.voice}
                onPick={pickVoice}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ---------- sub-components ---------- */
function VoiceGroup({ label, list, sel, onPick }) {
  if (!list.length) return null;
  return (
    <View>
      <Text style={st.groupLabel}>{label}</Text>
      {list.map((v, i) => (
        <Pressable key={(v.identifier || v.name) + i} style={st.voiceItem} onPress={() => onPick(v.identifier)}>
          <Text style={[st.voiceItemT, v.identifier === sel && { color: C.honey, fontWeight: '800' }]}>
            {cleanName(v)}
          </Text>
          {v.identifier === sel && <Text style={st.check}>✓</Text>}
        </Pressable>
      ))}
    </View>
  );
}

function HistoryRows({ rows, expanded, editing, onSpeak, onSave, onDelete }) {
  const dayLabel = (ts) => {
    const d = new Date(ts), n = new Date();
    const strip = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((strip(n) - strip(d)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const timeLabel = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const [savedSet, setSavedSet] = useState({});

  let lastDay = null;
  return (
    <View>
      {rows.map((h, idx) => {
        const dl = dayLabel(h.ts);
        const showDay = expanded && dl !== lastDay;
        if (showDay) lastDay = dl;
        return (
          <View key={h.t + idx}>
            {showDay && <Text style={st.dayLabel}>{dl}</Text>}
            <View style={st.hrow}>
              <Pressable style={{ flex: 1 }} onPress={() => onSpeak(h.t)}>
                <Text style={st.htext} numberOfLines={1}>{h.t}</Text>
              </Pressable>
              {!editing ? (
                <Text style={st.time}>{(h.n > 1 ? h.n + '× · ' : '') + timeLabel(h.ts)}</Text>
              ) : (
                <View style={st.tools}>
                  <Pressable style={st.mini} onPress={() => { onSave(h.t); setSavedSet((p) => ({ ...p, [h.t]: true })); }}>
                    <Text style={[st.miniT, { color: C.honey }]}>{savedSet[h.t] ? 'Saved' : 'Save'}</Text>
                  </Pressable>
                  <Pressable style={st.mini} onPress={() => onDelete(h.t)}>
                    <Text style={[st.miniT, { color: C.rose }]}>×</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Howto() {
  const steps = Platform.OS === 'android'
    ? ['Open Settings → Accessibility → Text-to-speech output',
       'Set the engine to Google Speech Services',
       'Tap the gear → Install voice data → English',
       'Come back here and choose it above']
    : ['Open Settings',
       'Tap Accessibility → Spoken Content → Voices',
       'Tap English, pick a voice marked Premium or Enhanced, let it download',
       'Come back here and choose it above'];
  return (
    <View style={st.howto}>
      <Text style={st.howtoP}>
        The voices built into a phone are basic. Downloading one free high-quality voice makes the biggest difference:
      </Text>
      {steps.map((step, i) => (
        <Text key={i} style={st.howtoLi}>{`${i + 1}.  ${step}`}</Text>
      ))}
    </View>
  );
}

/* ---------- styles ---------- */
const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ink },
  wrap: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 48, maxWidth: 620, width: '100%', alignSelf: 'center' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.honey },
  h1: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, color: C.text },
  iconBtn: { backgroundColor: C.ink2, width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  iconBtnOn: { backgroundColor: C.honey, borderColor: 'transparent' },
  gear: { fontSize: 18, color: C.muted },

  panel: { backgroundColor: C.ink2, borderRadius: 20, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  field: { marginBottom: 16 },
  lbl: { fontSize: 12, letterSpacing: 1, color: C.muted, fontWeight: '700', marginBottom: 8 },
  voiceRow: { flexDirection: 'row', gap: 9 },
  voicePick: { flex: 1, backgroundColor: C.ink3, borderRadius: 12, paddingHorizontal: 12, height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  voicePickText: { color: C.text, fontSize: 15, flex: 1 },
  chevron: { color: C.muted, fontSize: 14, marginLeft: 8 },
  prev: { backgroundColor: C.ink3, borderRadius: 12, paddingHorizontal: 15, height: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  prevText: { color: C.honey, fontWeight: '700', fontSize: 14 },
  help: { color: C.honey, fontSize: 13, fontWeight: '700', paddingTop: 10 },
  howto: { marginTop: 10, backgroundColor: C.ink, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(245,180,97,0.28)' },
  howtoP: { color: C.text, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  howtoLi: { color: C.muted, fontSize: 14, lineHeight: 24 },
  rowLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchT: { color: C.text, fontSize: 15, fontWeight: '600' },
  subtle: { color: C.faint, fontSize: 12.5, lineHeight: 17, marginTop: 3 },
  natNote: { marginTop: 10, backgroundColor: C.ink, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(245,180,97,0.22)' },
  natNoteT: { color: C.honey, fontSize: 13.5, fontWeight: '700', flex: 1, paddingRight: 10 },
  bar: { height: 4, borderRadius: 2, backgroundColor: C.ink3, marginTop: 9, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: C.honey },
  chipsTight: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 11 },
  natChip: { backgroundColor: C.ink3, borderRadius: 11, paddingVertical: 8, paddingHorizontal: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  natChipOn: { backgroundColor: C.honey, borderColor: 'transparent' },
  natChipT: { color: C.text, fontSize: 14, fontWeight: '700' },
  reset: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 14, alignItems: 'center' },
  resetT: { color: C.honey, fontSize: 15, fontWeight: '700' },
  resetSub: { color: C.faint, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 6 },

  composer: { backgroundColor: C.ink2, borderRadius: 26, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  composerLive: { borderColor: 'rgba(245,180,97,0.55)' },
  box: { color: C.text, fontSize: 27, fontWeight: '600', lineHeight: 40, minHeight: 140, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { borderRadius: 16, minHeight: 58, alignItems: 'center', justifyContent: 'center' },
  speak: { flex: 1, backgroundColor: C.honey },
  speakT: { color: '#241628', fontWeight: '800', fontSize: 17 },
  speakRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  btnGhost: { backgroundColor: C.ink3, borderRadius: 16, minHeight: 58, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  ghostT: { color: C.muted, fontWeight: '700', fontSize: 16 },

  sec: { marginTop: 26 },
  secHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 },
  secTitle: { fontSize: 12, letterSpacing: 1.2, color: C.muted, fontWeight: '700' },
  link: { color: C.honey, fontSize: 14, fontWeight: '700' },
  danger: { color: C.rose },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  chip: { backgroundColor: C.ink2, borderRadius: 15, paddingVertical: 13, paddingHorizontal: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  chipT: { color: C.text, fontSize: 16, fontWeight: '600' },
  chipAdd: { borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.18)' },
  chipX: { position: 'absolute', top: -7, right: -7, width: 22, height: 22, borderRadius: 11, backgroundColor: C.rose, alignItems: 'center', justifyContent: 'center' },
  chipXT: { color: '#2A1D33', fontSize: 14, fontWeight: '800', lineHeight: 16 },
  chipAddRow: { flexDirection: 'row', gap: 8, flexBasis: '100%' },
  chipInput: { flex: 1, backgroundColor: C.ink2, borderRadius: 15, paddingVertical: 13, paddingHorizontal: 15, color: C.text, fontSize: 16, fontWeight: '600', borderWidth: 1, borderColor: C.honey },
  chipGo: { backgroundColor: C.honey, borderRadius: 15, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  chipGoT: { color: '#241628', fontWeight: '800', fontSize: 15 },

  search: { backgroundColor: C.ink3, borderRadius: 12, paddingHorizontal: 12, height: 46, color: C.text, fontSize: 15, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  histCard: { backgroundColor: C.ink2, borderRadius: 18, paddingHorizontal: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  dayLabel: { fontSize: 11, letterSpacing: 1.2, color: C.honeyDim, fontWeight: '700', marginTop: 16, marginBottom: 2 },
  hrow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.07)', minHeight: 48 },
  htext: { color: C.text, fontSize: 16, fontWeight: '600', paddingVertical: 13 },
  time: { color: C.faint, fontSize: 12 },
  tools: { flexDirection: 'row', gap: 6 },
  mini: { backgroundColor: C.ink3, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  miniT: { fontSize: 13, fontWeight: '700' },
  empty: { color: C.faint, fontSize: 15, lineHeight: 21, paddingVertical: 14 },
  more: { backgroundColor: C.ink2, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  moreT: { color: C.muted, fontSize: 14, fontWeight: '700' },

  note: { color: C.faint, fontSize: 13, lineHeight: 19, marginTop: 30, textAlign: 'center' },

  modalWrap: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: C.ink2, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 34, paddingTop: 8, borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14 },
  sheetTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  groupLabel: { fontSize: 11, letterSpacing: 1.2, color: C.honeyDim, fontWeight: '700', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 4 },
  groupNote: { color: C.faint, fontSize: 12.5, lineHeight: 17, paddingHorizontal: 18, paddingBottom: 6 },
  voiceItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.05)' },
  voiceItemT: { color: C.text, fontSize: 16, fontWeight: '600' },
  check: { color: C.honey, fontSize: 16, fontWeight: '800' },
});
