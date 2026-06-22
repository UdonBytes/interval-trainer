"""Convert the app's required AIFF piano notes to compact browser-ready WAV files."""

from array import array
from pathlib import Path
import aifc
import wave


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "piano_samples"
DESTINATION = ROOT / "public" / "piano"
NOTES = (
    "G3", "Ab3", "A3", "Bb3", "B3",
    "C4", "Db4", "D4", "Eb4", "E4", "F4", "Gb4", "G4", "Ab4", "A4", "Bb4", "B4",
    "C5", "Db5", "D5", "Eb5", "E5", "F5", "Gb5", "G5",
)
MAX_SECONDS = 5
FADE_SECONDS = 0.2
PRE_ATTACK_SECONDS = 0.02
TARGET_PEAK = 0.78 * 32767


def convert(note: str) -> None:
    source = SOURCE / f"Piano.mf.{note}.aiff"
    destination = DESTINATION / f"{note}.wav"
    with aifc.open(str(source), "rb") as audio:
        channels, width, rate, frames, compression, _ = audio.getparams()
        if compression != b"NONE" or width != 2 or channels not in (1, 2):
            raise ValueError(f"Unsupported AIFF format for {source.name}: {audio.getparams()}")
        samples = array("h")
        samples.frombytes(audio.readframes(frames))
        samples.byteswap()  # AIFF PCM is big-endian; WAV PCM is little-endian.

    if channels == 2:
        samples = array("h", ((samples[i] + samples[i + 1]) // 2 for i in range(0, len(samples), 2)))

    # Remove the recording's leading room silence so drag previews speak immediately.
    original_peak = max(abs(sample) for sample in samples)
    onset_threshold = max(80, int(original_peak * 0.015))
    onset = next((index for index, sample in enumerate(samples) if abs(sample) >= onset_threshold), 0)
    start = max(0, onset - int(rate * PRE_ATTACK_SECONDS))
    samples = samples[start:start + rate * MAX_SECONDS]

    # These mf recordings are quiet; use one consistent healthy browser playback level.
    trimmed_peak = max(abs(sample) for sample in samples)
    scale = TARGET_PEAK / trimmed_peak if trimmed_peak else 1
    samples = array("h", (max(-32768, min(32767, round(sample * scale))) for sample in samples))

    fade_frames = min(len(samples), int(rate * FADE_SECONDS))
    for offset in range(fade_frames):
        index = len(samples) - fade_frames + offset
        samples[index] = int(samples[index] * (fade_frames - offset) / fade_frames)

    with wave.open(str(destination), "wb") as output:
        output.setparams((1, width, rate, len(samples), "NONE", "not compressed"))
        output.writeframes(samples.tobytes())
    print(f"{source.name} -> public/piano/{destination.name}")


if __name__ == "__main__":
    DESTINATION.mkdir(parents=True, exist_ok=True)
    missing = [f"Piano.mf.{note}.aiff" for note in NOTES if not (SOURCE / f"Piano.mf.{note}.aiff").exists()]
    if missing:
        raise FileNotFoundError("Missing required samples: " + ", ".join(missing))
    for required_note in NOTES:
        convert(required_note)
