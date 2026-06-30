import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// Interval data is semitone-based so the same selector works from any anchor note.
const INTERVALS = [
  { id: 'm2', name: 'Minor 2nd', semitones: 1 },
  { id: 'M2', name: 'Major 2nd', semitones: 2 },
  { id: 'm3', name: 'Minor 3rd', semitones: 3 },
  { id: 'M3', name: 'Major 3rd', semitones: 4 },
  { id: 'P4', name: 'Perfect 4th', semitones: 5 },
  { id: 'TT', name: 'Aug4 / Dim5', semitones: 6 },
  { id: 'P5', name: 'Perfect 5th', semitones: 7 },
  { id: 'm6', name: 'Minor 6th', semitones: 8 },
  { id: 'M6', name: 'Major 6th', semitones: 9 },
  { id: 'm7', name: 'Minor 7th', semitones: 10 },
  { id: 'M7', name: 'Major 7th', semitones: 11 },
  { id: 'P8', name: 'Perfect Octave', semitones: 12 },
  { id: 'm9', name: 'Minor 9th', semitones: 13 },
  { id: 'M9', name: 'Major 9th', semitones: 14 },
];
const INTERVAL_COLUMNS = [
  { label: '2nds', ids: ['M2', 'm2'] }, { label: '3rds', ids: ['M3', 'm3'] },
  { label: '4th', ids: ['P4'] }, { label: 'Aug4/Dim5', ids: ['TT'], special: true },
  { label: '5th', ids: ['P5'] }, { label: '6th', ids: ['M6', 'm6'] },
  { label: '7th', ids: ['M7', 'm7'] }, { label: '8ve', ids: ['P8'] },
  { label: '9th', ids: ['M9', 'm9'] },
];
const RCM_PRESETS = {
  'Level 1': ['m3', 'M3'],
  'Level 2': ['m3', 'M3', 'P5'],
  'Level 3': ['m3', 'M3', 'P4', 'P5'],
  'Level 4': ['m3', 'M3', 'P4', 'P5', 'P8'],
  'Level 5': ['m3', 'M3', 'P4', 'P5', 'm6', 'M6', 'P8'],
  'Level 6': ['m2', 'M2', 'm3', 'M3', 'P4', 'P5', 'm6', 'M6', 'P8'],
  'Level 7': ['m2', 'M2', 'm3', 'M3', 'P4', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'],
  'Level 8': ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'],
  'Level 9': ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'],
  'Level 10': INTERVALS.map((interval) => interval.id),
};
const RCM_LEVELS = ['Custom', ...Object.keys(RCM_PRESETS)];
const STARTING_NOTES = ['G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4'];
const SAMPLE_PITCHES = [
  'G3', 'Ab3', 'A3', 'Bb3', 'B3', 'C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4',
  'G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5', 'Eb5', 'E5', 'F5', 'Gb5', 'G5',
];
const KEY_SIGNATURES = {
  C: {},
  G: { F: '#' },
  D: { F: '#', C: '#' },
  A: { F: '#', C: '#', G: '#' },
  E: { F: '#', C: '#', G: '#', D: '#' },
  B: { F: '#', C: '#', G: '#', D: '#', A: '#' },
  F: { B: 'b' },
};
const INTERVAL_TARGETS = {
  m2: { degree: 1, lowered: true }, M2: { degree: 1, lowered: false },
  m3: { degree: 2, lowered: true }, M3: { degree: 2, lowered: false },
  P4: { degree: 3, lowered: false }, TT: { degree: 4, lowered: true },
  P5: { degree: 4, lowered: false },
  m6: { degree: 5, lowered: true }, M6: { degree: 5, lowered: false },
  m7: { degree: 6, lowered: true }, M7: { degree: 6, lowered: false },
  P8: { degree: 7, lowered: false },
  m9: { degree: 8, lowered: true }, M9: { degree: 8, lowered: false },
};
const LOWERABLE_DEGREES = new Set([1, 2, 4, 5, 6, 8]);
const FREE_LISTENING_TEXT = 'Free listening mode: choose intervals to start a mystery note.';
const audioBuffers = new Map();
const sampleArrayBuffers = new Map();
let audioContext;
let sampleFetchPromise;
let sampleDecodePromise;
let previewSource;
let previewGain;
let previewRequest = 0;
let sequenceVoices = [];
let sequenceRequest = 0;
let audioWarmPromise;
let audioWarmed = false;

function getAudioContext() {
  if (typeof window === 'undefined') throw new Error('Audio is only available in the browser.');
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('This browser does not support Web Audio piano playback.');
  audioContext ||= new AudioContextClass();
  return audioContext;
}

// Fetch the real piano recordings early, but do not create/decode an AudioContext
// until a user taps. iOS Safari can block contexts that are created during load.
function fetchPianoSamples() {
  if (sampleFetchPromise) return sampleFetchPromise;
  sampleFetchPromise = Promise.all(SAMPLE_PITCHES.map(async (pitch) => {
    const response = await fetch(`/piano/${pitch}.wav`);
    if (!response.ok) throw new Error(`Missing piano sample file: public/piano/${pitch}.wav`);
    sampleArrayBuffers.set(pitch, await response.arrayBuffer());
  }));
  return sampleFetchPromise;
}

// Decode once after Safari has allowed the AudioContext. Dragging only reads
// these cached buffers; no sample files are loaded during movement.
async function decodePianoSamples(context) {
  if (audioBuffers.size === SAMPLE_PITCHES.length) return;
  if (sampleDecodePromise) return sampleDecodePromise;
  sampleDecodePromise = (async () => {
    await fetchPianoSamples();
    await Promise.all(SAMPLE_PITCHES.map(async (pitch) => {
      if (audioBuffers.has(pitch)) return;
      const arrayBuffer = sampleArrayBuffers.get(pitch);
      if (!arrayBuffer) throw new Error(`Missing piano sample file: public/piano/${pitch}.wav`);
      try {
        // Safari may detach the buffer during decode, so pass a fresh copy.
        audioBuffers.set(pitch, await context.decodeAudioData(arrayBuffer.slice(0)));
      } catch {
        throw new Error(`Could not decode piano sample: public/piano/${pitch}.wav`);
      }
    }));
  })();
  return sampleDecodePromise;
}

// Kept as a readable app-level name: all samples are fully ready only after
// Safari's user-gesture unlock plus decode have completed.
async function preloadPianoSamples() {
  const context = getAudioContext();
  await decodePianoSamples(context);
}

function stopPreview() {
  if (previewSource) {
    try { previewSource.stop(); } catch { /* already stopped */ }
    previewSource.disconnect();
    previewGain?.disconnect();
    previewSource = undefined;
    previewGain = undefined;
  }
}

function cancelPreview() {
  previewRequest += 1;
  stopPreview();
}

function stopSequenceSources() {
  sequenceVoices.forEach(({ source, gain }) => {
    try { source.stop(); } catch { /* already stopped */ }
    source.disconnect();
    gain.disconnect();
  });
  sequenceVoices = [];
}

function cancelSequence() {
  sequenceRequest += 1;
  stopSequenceSources();
}

function stopAllAudio() {
  cancelSequence();
  cancelPreview();
}

async function unlockAudio() {
  const context = getAudioContext();
  // On iOS Safari, the resume + silent warmup need to be started directly from
  // a tap/click. Decode samples after that so the real first note is not eaten.
  const warmup = warmAudioContext(context);
  if (context.state === 'suspended') {
    await Promise.race([
      context.resume(),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Tap Play or a note once more so Safari can start the piano.'), { name: 'NotAllowedError' })), 1400)),
    ]);
  }
  if (context.state !== 'running') {
    throw Object.assign(new Error('Tap Play or a note once more so Safari can start the piano.'), { name: 'NotAllowedError' });
  }
  await warmup;
  await preloadPianoSamples();
  return context;
}

function warmAudioContext(context) {
  if (audioWarmed && context.state === 'running') return Promise.resolve();
  if (audioWarmPromise) return audioWarmPromise;
  audioWarmPromise = new Promise((resolve) => {
    let finished = false;
    const buffer = context.createBuffer(1, 1, context.sampleRate);
    const source = context.createBufferSource();
    const gain = context.createGain();
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(fallback);
      try { source.disconnect(); } catch { /* already disconnected */ }
      try { gain.disconnect(); } catch { /* already disconnected */ }
      audioWarmed = true;
      audioWarmPromise = undefined;
      resolve();
    };
    const fallback = setTimeout(finish, 120);
    source.buffer = buffer;
    gain.gain.setValueAtTime(0, context.currentTime);
    source.connect(gain).connect(context.destination);
    source.onended = finish;
    try {
      source.start(context.currentTime);
      source.stop(context.currentTime + .001);
    } catch {
      finish();
    }
  });
  return audioWarmPromise;
}

function startSample(context, pitch, startTime, volume = .72, duration) {
  const buffer = audioBuffers.get(pitch);
  if (!buffer) throw new Error(`Missing decoded piano sample: public/piano/${pitch}.wav`);
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.setValueAtTime(volume, startTime);
  source.connect(gain).connect(context.destination);
  source.start(startTime);
  if (duration) {
    gain.gain.setValueAtTime(volume, startTime + Math.max(0, duration - .08));
    gain.gain.linearRampToValueAtTime(0, startTime + duration);
    source.stop(startTime + duration + .01);
  }
  return { source, gain };
}

async function playPreviewSample(pitch) {
  const request = ++previewRequest;
  stopPreview();
  cancelSequence();
  const context = await unlockAudio();
  if (request !== previewRequest) return;
  const voice = startSample(context, pitch, context.currentTime + .01, .58, .84);
  previewSource = voice.source;
  previewGain = voice.gain;
  previewSource.onended = () => {
    if (previewSource === voice.source) stopPreview();
  };
}

async function playPair(anchorPitch, secondPitch) {
  const request = ++sequenceRequest;
  stopSequenceSources();
  cancelPreview();
  const context = await unlockAudio();
  if (request !== sequenceRequest) return;
  // Schedule both notes from one confirmed Web Audio clock time so the second
  // note never fires early if the first gesture had to resume/warm the context.
  const now = context.currentTime + .03;
  const first = startSample(context, anchorPitch, now, .72, .7);
  const second = startSample(context, secondPitch, now + .78, .72, .82);
  sequenceVoices = [first, second];
  sequenceVoices.forEach((voice) => {
    voice.source.onended = () => {
      voice.source.disconnect();
      voice.gain.disconnect();
      sequenceVoices = sequenceVoices.filter((active) => active.source !== voice.source);
    };
  });
}

const STAFF_BOTTOM_LINE_Y = 190;
const STAFF_STEP_Y = 15;
const STAFF_VIEWBOX_HEIGHT = 310;
const STUDENT_NOTE_X = 475;
const ANSWER_NOTE_X = 560;
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const FLAT_PITCH_CLASS = {
  0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F',
  6: 'Gb', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B',
};

function parsePitch(pitch) {
  const [, letter, accidental = '', octave] = pitch.match(/^([A-G])(b?)(\d)$/) || [];
  return { letter, accidental, octave: Number(octave) };
}

function pitchToMidi(pitch) {
  const { letter, accidental, octave } = parsePitch(pitch);
  return (octave + 1) * 12 + LETTER_TO_SEMITONE[letter] - (accidental === 'b' ? 1 : 0);
}

function pitchFromMidi(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return `${FLAT_PITCH_CLASS[((midi % 12) + 12) % 12]}${octave}`;
}

function pitchLabel(pitch) {
  return pitch.replace('b', '♭').replace(/\d$/, '');
}

function isFlatPitch(pitch) {
  return pitch.includes('b');
}

function naturalFromFlatPitch(pitch) {
  return pitch.replace('b', '');
}

function targetForInterval(anchorPitch, interval) {
  const pitch = pitchFromMidi(pitchToMidi(anchorPitch) + interval.semitones);
  return { ...interval, pitch, note: pitchLabel(pitch), naturalPitch: naturalFromFlatPitch(pitch), needsFlat: isFlatPitch(pitch) };
}

function naturalLadderFromAnchor(anchorPitch) {
  const { letter, octave } = parsePitch(anchorPitch);
  const start = LETTERS.indexOf(letter);
  return Array.from({ length: 9 }, (_, index) => {
    const absoluteStep = start + index;
    const nextLetter = LETTERS[absoluteStep % 7];
    const nextOctave = octave + Math.floor(absoluteStep / 7);
    return `${nextLetter}${nextOctave}`;
  });
}

function canFlattenPitch(pitch) {
  return SAMPLE_PITCHES.includes(pitchFromMidi(pitchToMidi(pitch) - 1));
}

function parseWrittenPitch(pitch) {
  const [, letter, accidental = '', octave] = pitch.match(/^([A-G])([b#]?)(\d)$/) || [];
  return { letter, accidental, octave: Number(octave) };
}

function writtenAccidentalOffset(accidental = '') {
  if (accidental === '#') return 1;
  if (accidental === 'b') return -1;
  if (accidental === 'bb') return -2;
  return 0;
}

function writtenPitchToMidi(pitch) {
  const { letter, accidental, octave } = parseWrittenPitch(pitch);
  return (octave + 1) * 12 + LETTER_TO_SEMITONE[letter] + writtenAccidentalOffset(accidental);
}

function accidentalSymbol(accidental = '') {
  if (accidental === '#') return '♯';
  if (accidental === 'b') return '♭';
  if (accidental === 'bb') return '𝄫';
  if (accidental === 'natural') return '♮';
  return '';
}

function majorKeyAccidental(anchorPitch, staffPitch) {
  return KEY_SIGNATURES[parseWrittenPitch(anchorPitch).letter]?.[parseWrittenPitch(staffPitch).letter] ?? '';
}

function loweredAccidental(accidental = '') {
  if (accidental === '#') return 'natural';
  if (accidental === '') return 'b';
  if (accidental === 'b') return 'bb';
  return accidental;
}

function midiForStaffSpelling(staffPitch, accidental = '') {
  const { letter, octave } = parseWrittenPitch(staffPitch);
  const offset = accidental === 'natural' ? 0 : writtenAccidentalOffset(accidental);
  return (octave + 1) * 12 + LETTER_TO_SEMITONE[letter] + offset;
}

// Staff positions are scale-degree landmarks in the anchor note's major key.
// The Lower button lowers that written scale-degree pitch by one semitone.
function spellingForSelection(anchorPitch, staffPitch, lowered = false) {
  const regularAccidental = majorKeyAccidental(anchorPitch, staffPitch);
  const accidental = lowered ? loweredAccidental(regularAccidental) : regularAccidental;
  const midi = midiForStaffSpelling(staffPitch, accidental);
  const samplePitch = pitchFromMidi(midi);
  const label = `${parseWrittenPitch(staffPitch).letter}${accidentalSymbol(accidental)}`;
  return { accidental, midi, samplePitch, label };
}

function targetForIntervalInKey(anchorPitch, interval) {
  const target = INTERVAL_TARGETS[interval.id];
  const staffPitch = naturalLadderFromAnchor(anchorPitch)[target.degree];
  const spelling = spellingForSelection(anchorPitch, staffPitch, target.lowered);
  return { ...interval, ...spelling, staffPitch, lowered: target.lowered, note: spelling.label };
}

function scaleDegreeForPitch(anchorPitch, staffPitch) {
  return naturalLadderFromAnchor(anchorPitch).indexOf(staffPitch);
}

function canLowerSelection(anchorPitch, staffPitch) {
  const degree = scaleDegreeForPitch(anchorPitch, staffPitch);
  return LOWERABLE_DEGREES.has(degree) && SAMPLE_PITCHES.includes(spellingForSelection(anchorPitch, staffPitch, true).samplePitch);
}

function largestSelectedDegree(intervals) {
  if (!intervals.length) return 8;
  return Math.max(...intervals.map((interval) => INTERVAL_TARGETS[interval.id]?.degree ?? 0));
}

function intervalNameForSelection(anchorPitch, staffPitch, lowered) {
  const semitones = spellingForSelection(anchorPitch, staffPitch, lowered).midi - writtenPitchToMidi(anchorPitch);
  if (semitones === 0) return 'Unison';
  return INTERVALS.find((interval) => interval.semitones === semitones)?.name ?? 'Choose a note';
}

// Treble staff coordinate system:
// E4 is the bottom staff line at y=190; each diatonic line/space step is 15px.
// This single mapping is used for anchor, student, answer, dragging, and ledger lines.
function pitchToStaffY(pitch) {
  const letter = pitch[0];
  const octave = Number(pitch.at(-1));
  const diatonicStepFromC4 = (octave - 4) * 7 + LETTERS.indexOf(letter);
  return STAFF_BOTTOM_LINE_Y - (diatonicStepFromC4 - 2) * STAFF_STEP_Y;
}

function pitchFromStaffY(pointerY, naturalPitches) {
  return naturalPitches.reduce((closest, pitch) =>
    Math.abs(pitchToStaffY(pitch) - pointerY) < Math.abs(pitchToStaffY(closest) - pointerY) ? pitch : closest
  );
}

function adjustedPitch(naturalPitch, flatOn) {
  return flatOn ? `${naturalPitch[0]}b${naturalPitch.at(-1)}` : naturalPitch;
}

function intervalNameForPitch(anchorPitch, pitch) {
  const semitones = pitchToMidi(pitch) - pitchToMidi(anchorPitch);
  if (semitones === 0) return 'Unison';
  return INTERVALS.find((interval) => interval.semitones === semitones)?.name ?? 'Choose a note';
}

function ledgerLineYs(pitch) {
  const y = pitchToStaffY(pitch);
  const lines = [];
  for (let ledgerY = STAFF_BOTTOM_LINE_Y + STAFF_STEP_Y * 2; ledgerY <= y; ledgerY += STAFF_STEP_Y * 2) {
    lines.push(ledgerY);
  }
  for (let ledgerY = 70 - STAFF_STEP_Y * 2; ledgerY >= y; ledgerY -= STAFF_STEP_Y * 2) {
    lines.push(ledgerY);
  }
  return lines;
}

function LedgerLines({ x, pitch, className = '' }) {
  return ledgerLineYs(pitch).map((y) =>
    <line key={`${pitch}-${y}`} x1={x - 27} x2={x + 27} y1={y} y2={y} className={`ledger ${className}`} />
  );
}

function MusicNote({ x, y, accidental, color, draggable, onPointerDown }) {
  return <g className={draggable ? 'drag-note' : ''} onPointerDown={onPointerDown}>
    {accidental && <text x={x - 39} y={y + 8} className="accidental" fill={color}>♭</text>}
    <ellipse cx={x} cy={y} rx="18.5" ry="13.2" transform={`rotate(-14 ${x} ${y})`} fill={color} />
  </g>;
}

function SpelledMusicNote({ x, y, accidental, color, draggable, onPointerDown, onTouchStart }) {
  const baseAccidentalLayout = {
    b: { x: -48, y: 8, size: 45 },
    '#': { x: -49, y: 14, size: 42 },
    natural: { x: -49, y: 15, size: 49 },
    bb: { x: -54, y: 8, size: 42 },
  }[accidental] ?? { x: -48, y: 10, size: 45 };
  // The pink student note gets extra horizontal breathing room for accidentals
  // and a larger invisible target so small fingers can tap/drag beside the notehead.
  const accidentalLayout = draggable
    ? { ...baseAccidentalLayout, x: baseAccidentalLayout.x - 11 }
    : baseAccidentalLayout;
  return <g className={draggable ? 'drag-note' : ''} onPointerDown={onPointerDown} onTouchStart={onTouchStart}>
    {draggable && <rect x={x - 64} y={y - 52} width="188" height="104" rx="30" fill="transparent" pointerEvents="all" />}
    {accidental && <text x={x + accidentalLayout.x} y={y + accidentalLayout.y} className="accidental" style={{ fontSize: accidentalLayout.size }} fill={color}>{accidentalSymbol(accidental)}</text>}
    <ellipse cx={x} cy={y} rx="18.5" ry="13.2" transform={`rotate(-14 ${x} ${y})`} fill={color} />
  </g>;
}

function Staff({ anchorPitch, naturalPitches, guess, flatOn, setGuess, playCue, playAnchor, playStudent, answer, showingAnswer, audioReady }) {
  const svgRef = useRef(null);
  const dragging = useRef(false);
  const dragMoved = useRef(false);
  const dragLastClientY = useRef(0);
  const dragPitchIndex = useRef(0);
  const activeTouchId = useRef(null);
  const displaySpelling = spellingForSelection(anchorPitch, guess, flatOn);
  const displayName = displaySpelling.label;
  const anchorName = pitchLabel(anchorPitch);
  const liveIntervalName = intervalNameForSelection(anchorPitch, guess, flatOn);
  const beginDrag = (clientY) => {
    if (!audioReady) return;
    dragMoved.current = true;
    dragging.current = true;
    dragLastClientY.current = clientY;
    dragPitchIndex.current = Math.max(0, naturalPitches.indexOf(guess));
    playStudent();
  };
  const updateDragFromClientY = (clientY, isTouchDrag) => {
    if (!dragging.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const localY = (clientY - rect.top) / rect.height * STAFF_VIEWBOX_HEIGHT;
    const currentIndex = isTouchDrag ? dragPitchIndex.current : naturalPitches.indexOf(guess);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (isTouchDrag) {
      // On phones, the visual staff steps are physically small. Use an even
      // finger-distance threshold for every scale degree so the 2nd, 7th, octave,
      // and 9th all have equally usable snap zones.
      const visualStaffStepPx = rect.height / STAFF_VIEWBOX_HEIGHT * STAFF_STEP_Y;
      const stepThresholdPx = Math.max(12, visualStaffStepPx * 1.25);
      const deltaY = clientY - dragLastClientY.current;
      if (Math.abs(deltaY) < stepThresholdPx) return;
      nextIndex = currentIndex + (deltaY < 0 ? 1 : -1);
      dragLastClientY.current += (deltaY < 0 ? -stepThresholdPx : stepThresholdPx);
    } else {
      const target = pitchFromStaffY(localY, naturalPitches);
      const targetIndex = naturalPitches.indexOf(target);
      if (targetIndex < 0) return;
      nextIndex = Math.max(currentIndex - 1, Math.min(currentIndex + 1, targetIndex));
    }
    nextIndex = Math.max(0, Math.min(naturalPitches.length - 1, nextIndex));
    const next = naturalPitches[nextIndex];
    if (next !== guess) {
      dragMoved.current = true;
      dragPitchIndex.current = nextIndex;
      setGuess(next);
      playCue(spellingForSelection(anchorPitch, next, false).samplePitch);
    }
  };
  const updateFromPointer = (event) => {
    const isTouchDrag = event.pointerType === 'touch' || window.matchMedia?.('(pointer: coarse)').matches;
    updateDragFromClientY(event.clientY, isTouchDrag);
  };
  const updateFromTouch = (event) => {
    if (!dragging.current) return;
    const touch = Array.from(event.touches).find((item) => item.identifier === activeTouchId.current) || event.touches[0];
    if (!touch) return;
    event.preventDefault();
    updateDragFromClientY(touch.clientY, true);
  };
  const endTouchDrag = (event) => {
    if (!dragging.current) return;
    event.preventDefault();
    dragging.current = false;
    activeTouchId.current = null;
  };
  return <div className="staff-wrap"><svg ref={svgRef} className="staff" viewBox={`0 0 720 ${STAFF_VIEWBOX_HEIGHT}`}
    onPointerMove={updateFromPointer} onPointerUp={() => { dragging.current = false; }}
    onPointerLeave={() => { dragging.current = false; }}
    onTouchMove={updateFromTouch} onTouchEnd={endTouchDrag} onTouchCancel={endTouchDrag}
    aria-label={`Treble staff with anchor ${anchorPitch} and your movable note`}>
    <defs><filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#8b5e83" floodOpacity=".18" /></filter></defs>
    {[190, 160, 130, 100, 70].map((y) => <line key={y} x1="82" x2="670" y1={y} y2={y} className="staff-line" />)}
    <text x="87" y="188" className="clef">𝄞</text>
    <text x={STUDENT_NOTE_X} y="36" textAnchor="middle" className="live-interval-label">{liveIntervalName}</text>
    <LedgerLines x={242} pitch={anchorPitch} className="anchor-ledger" />
    <g className="anchor-note" role="button" tabIndex="0" aria-label={`Hear anchor note ${anchorPitch}`} aria-disabled={!audioReady} onClick={() => audioReady && playAnchor()}
      onKeyDown={(event) => { if (audioReady && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); playAnchor(); } }}>
      <circle cx="242" cy={pitchToStaffY(anchorPitch)} r="29" fill="transparent" />
      <SpelledMusicNote x={242} y={pitchToStaffY(anchorPitch)} color="#65558f" />
    </g>
    <text x="207" y="292" className="note-label anchor-label">tap to hear {anchorName}</text>
    {showingAnswer && <g opacity=".32"><LedgerLines x={ANSWER_NOTE_X} pitch={answer.staffPitch} className="answer-ledger" /><SpelledMusicNote x={ANSWER_NOTE_X} y={pitchToStaffY(answer.staffPitch)} accidental={answer.accidental} color="#22a06b" /></g>}
    <LedgerLines x={STUDENT_NOTE_X} pitch={guess} className="student-ledger" />
    <g filter="url(#shadow)" className="student-note-target" role="button" tabIndex="0" aria-label={`Hear student note ${displayName}`}
      onClick={() => { if (audioReady && !dragMoved.current) playStudent(); dragMoved.current = false; }}
      onKeyDown={(event) => { if (audioReady && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); playStudent(); } }}>
      <SpelledMusicNote x={STUDENT_NOTE_X} y={pitchToStaffY(guess)} accidental={displaySpelling.accidental} color="#e66f85" draggable
        onPointerDown={(event) => {
          if (!audioReady) return;
          beginDrag(event.clientY);
          try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* iOS/SVG may not support capture reliably */ }
        }}
        onTouchStart={(event) => {
          if (!audioReady) return;
          const touch = event.changedTouches[0];
          if (!touch) return;
          event.preventDefault();
          activeTouchId.current = touch.identifier;
          beginDrag(touch.clientY);
        }} />
    </g>
    <text x="432" y="292" className="note-label your-note">your note · {displayName}</text>
    <text x="588" y="58" className="drag-hint">↕ drag me</text>
  </svg></div>;
}

function App() {
  const [selectedIntervals, setSelectedIntervals] = useState(() => new Set());
  const [rcmLevel, setRcmLevel] = useState('Custom');
  const [rcmOpen, setRcmOpen] = useState(false);
  const rcmDropdownRef = useRef(null);
  const [intervalPanelOpen, setIntervalPanelOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    const saved = window.sessionStorage.getItem('intervalPanelOpen');
    if (saved !== null) return saved === 'true';
    return !window.matchMedia('(max-width: 700px)').matches;
  });
  const [anchorPitch, setAnchorPitch] = useState('C4');
  const eligible = useMemo(() => INTERVALS.filter((interval) => selectedIntervals.has(interval.id)), [selectedIntervals]);
  const fullNaturalPitches = useMemo(() => naturalLadderFromAnchor(anchorPitch), [anchorPitch]);
  const maxDragDegree = useMemo(() => largestSelectedDegree(eligible), [eligible]);
  const naturalPitches = useMemo(() => fullNaturalPitches.slice(0, maxDragDegree + 1), [fullNaturalPitches, maxDragDegree]);
  const [answerInterval, setAnswerInterval] = useState(INTERVALS[3]);
  const answer = useMemo(() => targetForIntervalInKey(anchorPitch, answerInterval), [anchorPitch, answerInterval]);
  const [guess, setGuess] = useState('C4');
  const [flatOn, setFlatOn] = useState(false);
  const [feedback, setFeedback] = useState({ kind: 'ready', text: FREE_LISTENING_TEXT });
  const [showingAnswer, setShowingAnswer] = useState(false);
  const [sampleError, setSampleError] = useState('');
  const [sampleFilesReady, setSampleFilesReady] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const safelyPlay = async (playback) => {
    try {
      setSampleError('');
      await playback();
      setAudioReady(true);
    }
    catch (error) {
      setAudioReady(false);
      setSampleError(error.name === 'NotAllowedError'
        ? 'Tap Play or a note once more so Safari can start the piano.'
        : error.message);
    }
  };
  const playCue = (pitch) => safelyPlay(() => playPreviewSample(pitch));
  const chooseNaturalNote = (pitch) => {
    setGuess(pitch);
    setFlatOn(false);
  };
  const canUseFlatToggle = (pitch = guess) => canLowerSelection(anchorPitch, pitch);
  const toggleFlat = () => {
    if (!canUseFlatToggle()) return;
    const nextFlat = !flatOn;
    setFlatOn(nextFlat);
    playCue(spellingForSelection(anchorPitch, guess, nextFlat).samplePitch);
  };
  const toggleInterval = (id) => {
    setRcmLevel('Custom');
    setSelectedIntervals((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleIntervalGroup = (ids) => {
    setRcmLevel('Custom');
    setSelectedIntervals((current) => {
      const next = new Set(current);
      const allSelected = ids.every((id) => next.has(id));
      ids.forEach((id) => {
        if (allSelected) next.delete(id); else next.add(id);
      });
      return next;
    });
  };
  const clearIntervals = () => {
    setRcmLevel('Custom');
    setSelectedIntervals(new Set());
    stopAllAudio();
    setShowingAnswer(false);
    resetGuess();
    setFeedback({ kind: 'ready', text: FREE_LISTENING_TEXT });
  };
  const applyRcmLevel = (level) => {
    setRcmLevel(level);
    if (level !== 'Custom') setSelectedIntervals(new Set(RCM_PRESETS[level]));
    setRcmOpen(false);
  };
  const toggleIntervalPanel = () => {
    setIntervalPanelOpen((open) => {
      const next = !open;
      window.sessionStorage.setItem('intervalPanelOpen', String(next));
      return next;
    });
  };
  const resetGuess = (nextAnchor = anchorPitch) => {
    setGuess(nextAnchor);
    setFlatOn(false);
  };
  const chooseNext = (pool = eligible, nextAnchor = anchorPitch) => {
    stopAllAudio();
    if (!pool.length) {
      setShowingAnswer(false);
      resetGuess(nextAnchor);
      setFeedback({ kind: 'ready', text: FREE_LISTENING_TEXT });
      return;
    }
    const choices = pool;
    const alternatives = choices.filter((item) => item.id !== answerInterval.id);
    const nextPool = alternatives.length ? alternatives : choices;
    const next = nextPool[Math.floor(Math.random() * nextPool.length)];
    setAnswerInterval(next); resetGuess(nextAnchor); setShowingAnswer(false);
    setFeedback({ kind: 'ready', text: 'New mystery note! Tap Play when you are ready.' });
  };
  const changeAnchor = (direction) => {
    const currentIndex = STARTING_NOTES.indexOf(anchorPitch);
    const nextIndex = Math.max(0, Math.min(STARTING_NOTES.length - 1, currentIndex + direction));
    const nextAnchor = STARTING_NOTES[nextIndex];
    if (nextAnchor === anchorPitch) return;
    stopAllAudio();
    setAnchorPitch(nextAnchor);
    chooseNext(eligible, nextAnchor);
    safelyPlay(() => playPreviewSample(nextAnchor));
  };
  useEffect(() => {
    fetchPianoSamples()
      .then(() => setSampleFilesReady(true))
      .catch((error) => setSampleError(error.message));
  }, []);
  useEffect(() => {
    if (!sampleFilesReady || audioReady) return undefined;
    let cancelled = false;
    const primeAudioFromGesture = () => {
      unlockAudio()
        .then(() => { if (!cancelled) setAudioReady(true); })
        .catch(() => { /* The actual Play/note action will show any needed error. */ });
    };
    window.addEventListener('pointerdown', primeAudioFromGesture, { capture: true, once: true });
    window.addEventListener('touchstart', primeAudioFromGesture, { capture: true, once: true, passive: true });
    window.addEventListener('keydown', primeAudioFromGesture, { capture: true, once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', primeAudioFromGesture, { capture: true });
      window.removeEventListener('touchstart', primeAudioFromGesture, { capture: true });
      window.removeEventListener('keydown', primeAudioFromGesture, { capture: true });
    };
  }, [sampleFilesReady, audioReady]);
  useEffect(() => {
    if (!rcmOpen) return undefined;
    const closeFromOutside = (event) => {
      if (!rcmDropdownRef.current?.contains(event.target)) setRcmOpen(false);
    };
    const closeFromEscape = (event) => {
      if (event.key === 'Escape') setRcmOpen(false);
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromEscape);
    };
  }, [rcmOpen]);
  useEffect(() => {
    if (!eligible.length) {
      setShowingAnswer(false);
      setFeedback({ kind: 'ready', text: FREE_LISTENING_TEXT });
    } else if (feedback.text === FREE_LISTENING_TEXT || !eligible.some((item) => item.id === answerInterval.id)) chooseNext(eligible);
    // Start a fresh mystery when leaving free listening, or when interval choices
    // make the current answer ineligible. Manual note movement keeps the round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIntervals]);
  useEffect(() => {
    if (!naturalPitches.includes(guess)) resetGuess(anchorPitch);
    // Keep the pink note inside the currently guided ladder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalPitches]);
  const check = () => {
    const selected = spellingForSelection(anchorPitch, guess, flatOn);
    if (guess === answer.staffPitch && flatOn === answer.lowered) {
      setFeedback({ kind: 'correct', text: `You found it — ${answer.note}, a ${answer.name}! ✨` });
    } else if (guess === answer.staffPitch && answer.lowered && !flatOn) {
      setFeedback({ kind: 'try', text: 'Very close — try lowering this note.' });
    } else if (guess === answer.staffPitch && !answer.lowered && flatOn) {
      setFeedback({ kind: 'try', text: 'Very close — keep this regular note natural.' });
    } else if (selected.midi > answer.midi) {
      setFeedback({ kind: 'try', text: 'So close! Your note is a little too high.' });
    } else {
      setFeedback({ kind: 'try', text: 'Nearly there! Your note is a little too low.' });
    }
  };
  const handleKeyDown = (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const index = naturalPitches.indexOf(guess);
    if (index < 0) return;
    const nextIndex = Math.max(0, Math.min(naturalPitches.length - 1, index + (event.key === 'ArrowUp' ? 1 : -1)));
    const next = naturalPitches[nextIndex];
    chooseNaturalNote(next); playCue(spellingForSelection(anchorPitch, next, false).samplePitch);
  };
  return <main className="app-shell">
    <div className="sparkle sparkle-one">♪</div><div className="sparkle sparkle-two">♫</div>
    <header><div className="eyebrow">EAR TRAINING ADVENTURE</div><h1>Find the <span>2nd Note</span></h1><p>Hear two notes. Where does the second one belong?</p></header>
    <section className="game-card">
      <div className="settings-panel" aria-label="Interval settings">
        <div className="preset-bar">
          <div className="rcm-select" ref={rcmDropdownRef}>
            <span id="rcm-level-label">RCM Level</span>
            <button className="rcm-trigger" type="button" aria-labelledby="rcm-level-label rcm-level-value"
              aria-haspopup="listbox" aria-expanded={rcmOpen} aria-controls="rcm-level-menu"
              onClick={() => setRcmOpen((open) => !open)}
              onKeyDown={(event) => {
                if (['ArrowDown', 'Enter', ' '].includes(event.key)) {
                  event.preventDefault();
                  setRcmOpen(true);
                }
              }}>
              <span id="rcm-level-value">{rcmLevel}</span><span aria-hidden="true">⌄</span>
            </button>
            {rcmOpen && <div className="rcm-menu" id="rcm-level-menu" role="listbox" aria-labelledby="rcm-level-label">
              {RCM_LEVELS.map((level) => <button className={`rcm-option ${rcmLevel === level ? 'is-selected' : ''}`} type="button" role="option"
                aria-selected={rcmLevel === level} key={level} onClick={() => applyRcmLevel(level)}>
                {level}
              </button>)}
            </div>}
          </div>
          <button className="choose-intervals" type="button" aria-expanded={intervalPanelOpen} aria-controls="interval-options-panel" onClick={toggleIntervalPanel}>
            {intervalPanelOpen ? 'Hide intervals' : 'Show intervals'}
          </button>
          <button className="clear-intervals" type="button" onClick={clearIntervals}>Clear all</button>
          <div className="anchor-stepper" aria-label="Starting note">
            <span>Starting note:</span>
            <button type="button" disabled={!sampleFilesReady || STARTING_NOTES.indexOf(anchorPitch) === 0} onClick={() => changeAnchor(-1)}>←</button>
            <b>{anchorPitch}</b>
            <button type="button" disabled={!sampleFilesReady || STARTING_NOTES.indexOf(anchorPitch) === STARTING_NOTES.length - 1} onClick={() => changeAnchor(1)}>→</button>
          </div>
        </div>
        <div id="interval-options-panel" className={`interval-grid ${intervalPanelOpen ? 'is-open' : ''}`} role="group" aria-label="Choose intervals">
          {INTERVAL_COLUMNS.map((column) => {
            const groupSelected = column.ids.every((id) => selectedIntervals.has(id));
            return <div className={`interval-column ${column.special ? 'special' : ''} ${column.ids.some((id) => id.startsWith('P')) ? 'perfect-card' : ''} ${groupSelected ? 'group-selected' : ''}`} key={column.label}>
            <button className="interval-header" type="button" aria-pressed={groupSelected} title={column.label} onClick={() => toggleIntervalGroup(column.ids)}>{column.label}</button>
            {column.ids.map((id) => {
              const interval = INTERVALS.find((item) => item.id === id);
              const optionLabel = id === 'TT' ? 'Aug/Dim' : id.startsWith('M') ? 'Major' : id.startsWith('m') ? 'Minor' : 'Perfect';
              return <label className={`interval-option ${id.startsWith('P') ? 'is-perfect' : ''}`} key={id} title={interval.name}>
                <input type="checkbox" checked={selectedIntervals.has(id)} onChange={() => toggleInterval(id)} />
                <span>{optionLabel}</span>
              </label>;
            })}
          </div>;
          })}
        </div>
      </div>
      <div className="listen-row"><div className="step-badge">1</div><div><b>Listen, then find the 2nd note</b><small className="helper-desktop">Start with the regular note. If it sounds a little lower, use Lower this note.</small><small className="helper-mobile">Find the regular note first. Lower if needed.</small></div><button className="primary play" disabled={!sampleFilesReady || !eligible.length} onClick={() => safelyPlay(() => playPair(anchorPitch, answer.samplePitch))}><span>▶</span> Play</button></div>
      <div className="notation-area" tabIndex="0" onKeyDown={handleKeyDown} aria-label="Natural note ladder. Use up and down arrow keys to move your note.">
        <Staff anchorPitch={anchorPitch} naturalPitches={naturalPitches} guess={guess} flatOn={flatOn} setGuess={chooseNaturalNote} playCue={playCue}
          playAnchor={() => playCue(anchorPitch)} playStudent={() => playCue(spellingForSelection(anchorPitch, guess, flatOn).samplePitch)}
          answer={answer} showingAnswer={showingAnswer} audioReady={sampleFilesReady} />
        <button className={`flat-toggle ${flatOn ? 'is-on' : ''}`} disabled={!sampleFilesReady || !canUseFlatToggle()}
          aria-pressed={flatOn} onClick={toggleFlat}>Lower this note</button>
      </div>
      <div className="feedback" data-kind={sampleError ? 'error' : feedback.kind} aria-live="polite"><span>{sampleError ? '!' : feedback.kind === 'correct' ? '★' : feedback.kind === 'try' ? '♡' : '✦'}</span>{sampleError || (!sampleFilesReady ? 'Loading piano sounds…' : feedback.text)}</div>
      <div className="actions">
        <button className="soft" disabled={!sampleFilesReady} onClick={() => safelyPlay(() => playPair(anchorPitch, spellingForSelection(anchorPitch, guess, flatOn).samplePitch))}>♪ Hear My Note</button><button className="check" disabled={!sampleFilesReady || !eligible.length} onClick={check}>✓ Check</button>
        <button className="soft" disabled={!sampleFilesReady || !eligible.length} onClick={() => { setShowingAnswer(true); setFeedback({ kind: 'answer', text: `The answer is ${answer.note} — ${answer.name}. Give it a listen!` }); safelyPlay(() => playPair(anchorPitch, answer.samplePitch)); }}>👀 Show Answer</button>
        <button className="next" disabled={!sampleFilesReady} onClick={() => eligible.length ? chooseNext() : (resetGuess(), setFeedback({ kind: 'ready', text: FREE_LISTENING_TEXT }))}>Next <span>→</span></button>
      </div>
    </section><footer><span className="footer-tip">Tip: you can also use the ↑ ↓ keys.</span><span className="footer-credit">Created by Jane Hong (UdonBytes)</span></footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
