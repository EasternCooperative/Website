#!/usr/bin/env python3
"""Generate WebVTT captions for a gallery video with faster-whisper.

Usage (no install needed beyond uv and ffmpeg):

    uv run --with faster-whisper scripts/transcribe-captions.py VIDEO OUT.vtt \
        [--prompt "Context sentence."] [--hotwords "raisins, ECRS"] [--model large-v3]

Hotwords are the main accuracy lever for these old, noisy recordings: list the
names, game names, and odd words the video really uses so the model spells them
right. They bias every window, and Whisper will echo them into quiet stretches,
so list only words you have heard in the video.
On CPU (int8) large-v3 takes a few minutes per minute of audio; with
--device cuda (float16, no quantization loss) it is near real time or faster.
For CUDA from pip wheels, also install nvidia-cublas-cu12 and
nvidia-cudnn-cu12==9.* and put their lib/ directories on LD_LIBRARY_PATH.

--condition (carry text between windows) gives better punctuation but can
loop on music or crowd noise; check the output for repeated lines.

The gallery captions were made with large-v3 on CUDA, then hand-edited, so
rerunning will undo those edits:
  ice-cream-disaster  --condition --hotwords "raisins" --prompt "An improv
      skit at an ice cream factory. The owner tells the manager: I need
      400,000 raisins by Tuesday."  (tail from 4:39 and the 5:14 line fixed by hand,
      then 2:08-2:20 and 5:00-5:11 corrected by ear)
  spring-weekend-2009  --hotwords "elephant, palm tree, cow, stir the mush,
      ECRS" --prompt "Group games and dances at an ECRS weekend."  (dance calls
      and game lines the model dropped restored from the older base-model pass)
  lets-play-2000  still the older base-model captions; large-v3 dropped words.
"""

import argparse
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

MAX_LINE = 42  # characters per caption line
MAX_CUE = 6.0  # seconds a single cue may stay on screen
GAP_SPLIT = 0.8  # a pause this long between words starts a new cue


def ts(t: float) -> str:
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def wrap(text: str) -> str:
    """Split a cue's text into at most two balanced lines."""
    if len(text) <= MAX_LINE:
        return text
    words = text.split()
    best, best_diff = text, None
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        diff = abs(len(a) - len(b))
        if best_diff is None or diff < best_diff:
            best, best_diff = f"{a}\n{b}", diff
    return best


def cues_from_words(words):
    """Group word timestamps into readable cues of up to two lines."""
    cues, cur, start = [], [], 0.0
    for w in words:
        if cur:
            text = "".join(x.word for x in cur + [w]).strip()
            too_long = len(text) > MAX_LINE * 2
            too_slow = w.end - start > MAX_CUE
            paused = w.start - cur[-1].end > GAP_SPLIT
            sentence_end = cur[-1].word.rstrip().endswith((".", "?", "!")) and len(
                "".join(x.word for x in cur).strip()
            ) > MAX_LINE * 0.6
            if paused and len(cur) <= 2 and not cur[-1].word.rstrip().endswith((".", "?", "!")):
                # Over music, Whisper often stamps the first word or two of a
                # line well before the rest. Carry the fragment into the next
                # cue, timed from where the speech really resumes, rather than
                # flashing it on screen alone seconds early.
                start = w.start
            elif too_long or too_slow or paused or sentence_end:
                cues.append((start, cur))
                cur = []
        if not cur:
            start = w.start
        cur.append(w)
    if cur:
        cues.append((start, cur))
    return [(st, c[-1].end, "".join(x.word for x in c).strip()) for st, c in cues]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--prompt", default="", help="context sentence; steers the first window only")
    ap.add_argument(
        "--hotwords",
        default="",
        help="short comma list of words known to occur; biases every window, so never put guesses here",
    )
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--beam", type=int, default=10)
    ap.add_argument("--device", default="cpu", help="cpu (int8) or cuda (float16)")
    ap.add_argument(
        "--condition",
        action="store_true",
        help="feed each window the previous text: better punctuation, but a misheard line can repeat",
    )
    args = ap.parse_args()

    model = WhisperModel(
        args.model, device=args.device, compute_type="float16" if args.device == "cuda" else "int8"
    )
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", args.video, "-ac", "1", "-ar", "16000", str(wav)],
            check=True,
        )
        # Decode the WAV here rather than letting faster-whisper do it: its PyAV
        # decoder breaks whenever a new PyAV release changes av.open().
        with wave.open(str(wav)) as w:
            pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        audio = pcm.astype(np.float32) / 32768.0
        segments, _ = model.transcribe(
            audio,
            language="en",
            beam_size=args.beam,
            best_of=args.beam,
            temperature=[0.0, 0.2, 0.4, 0.6],
            initial_prompt=args.prompt or None,
            hotwords=args.hotwords or None,
            # Off by default: each window is decoded fresh, so one misheard line
            # can't snowball into a run of repeated "Thank you." hallucinations.
            condition_on_previous_text=args.condition,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            word_timestamps=True,
        )
        words = [w for seg in segments for w in (seg.words or [])]

    lines = ["WEBVTT", ""]
    for start, end, text in cues_from_words(words):
        if not text:
            continue
        lines += [f"{ts(start)} --> {ts(max(end, start + 0.5))}", wrap(text), ""]
    Path(args.out).write_text("\n".join(lines))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
