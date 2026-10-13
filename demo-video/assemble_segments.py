#!/usr/bin/env python3
"""Segment-level assembly — pairs with record_demo.js's per-segment isolated
recordings.

Each beat's recordings/<beat>/manifest.json lists its segments in order; each
segment has its own isolated webm (recordings/<beat>/segNN/*.webm) and its own
clicks.json ({"visibleStart": <seconds>, "clicks": [<seconds>, ...]} — both
relative to that segment's own recording, not the whole beat).

For each segment: trim off the invisible-but-actually-visible setup/replay
prefix (everything before visibleStart — see record_demo.js's file header),
mix the synthesized click sound into that segment's voiceover clip at the
logged click moments, pad whichever of video/audio is shorter (freeze last
video frame, or add silence) so the two match exactly, then concatenate all of
a beat's segments (hard cut — it's the same continuous screen, no transition
needed within a beat) and finally join all beats with a fade-through-color
"dip" between EVERY beat — including into and out of the hook.

Beat transitions deliberately do NOT use xfade/acrossfade. See
dip_transition_concat() below and ffmpeg-cookbook.md section 4b for the three
separate reasons that approach was abandoned after a real client delivery; the
short version is that overlapping blends silently failed past the first join,
were invisible where adjacent frames were near-identical by design, and made
narration audibly dip where two speech clips overlapped.

COPY THIS FILE and adapt paths/beat list to the real project. The hook beat
("00-hook" by convention) has no recording — it's a still frame (the
main-product screenshot from Phase 1) held for the length of its narration,
deliberately with NO zoom/pan (a Ken-Burns effect was tried and explicitly
rejected — it read as filler motion, not a demo of anything).

Usage: assemble_segments.py <output.mp4> <beat-name> [beat-name ...]
       (use "00-hook" for the still-frame hook beat)
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
FPS = 25
W, H = 1920, 1080
FADE = 0.4  # per-side dip duration, seconds — verified: long enough to read as
            # a deliberate transition, short enough not to feel like a lag.
            # Applied to BOTH sides of a join (out then in), not overlapped.

# Colour the picture dips through between beats. Do NOT leave this as a guess:
# pull the app's own CSS background token (e.g. --bg from its styles.css) so the
# dip reads as the app's own dark/light ground rather than a generic cut to
# black, and ask the user if they'd prefer something else. `fadeblack` was tried
# on a real delivery and the client found it too harsh.
# Use ffmpeg's 0x form rather than #RRGGBB — identical to ffmpeg, but '#' starts
# a comment if anyone pastes a command into a shell unquoted.
FADE_COLOR = "0xFAF9F6"  # app --bg


def run(cmd):
    subprocess.run(cmd, check=True)


def _probe(path, args):
    out = subprocess.run(
        ["ffprobe", "-v", "error", *args, "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    lines = [ln.strip() for ln in out.stdout.strip().splitlines() if ln.strip()]
    return lines[0] if lines else ""


def vdur(path):
    """Duration of the VIDEO STREAM — never the container's.

    A beat's final.mp4 routinely reports a container duration ~0.1s LONGER than
    its video stream, because the muxed audio track runs slightly longer. Time a
    fade against the container value and the fade starts after the last real
    video frame: it silently degrades or disappears entirely, with no error and
    no warning. This cost a full debugging round on a real build — always probe
    the stream when timing anything against picture.
    """
    v = _probe(path, ["-select_streams", "v", "-show_entries", "stream=duration"])
    if not v or v == "N/A":
        raise RuntimeError(
            f"{path}: no video-stream duration reported. Do NOT substitute the "
            "container duration here — fix the input instead (re-encode it so the "
            "stream carries a duration)."
        )
    return float(v)


def adur(path):
    """Duration of the audio stream, falling back to the container only for
    bare audio files (some MP3s report stream=duration as N/A, and for an
    audio-only file the container duration IS the audio duration)."""
    a = _probe(path, ["-select_streams", "a", "-show_entries", "stream=duration"])
    if not a or a == "N/A":
        a = _probe(path, ["-show_entries", "format=duration"])
    return float(a)


def container_dur(path):
    """Container duration — for progress logging only. Never time a fade,
    trim, or pad against this; use vdur()/adur()."""
    return float(_probe(path, ["-show_entries", "format=duration"]))


def mix_clicks(voice_path, click_times, click_wav, out_path):
    """adelay+amix each click onto the voiceover. normalize=0 is required —
    amix's default normalization halves the voice volume per extra input,
    which is wrong here (the clicks are a small accent, not an equal signal)."""
    if not click_times:
        shutil.copyfile(voice_path, out_path)
        return
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(voice_path)]
    for _ in click_times:
        cmd += ["-i", str(click_wav)]
    filter_parts = []
    mix_inputs = ["[0:a]"]
    for i, t in enumerate(click_times, start=1):
        ms = max(0, int(round(t * 1000)))
        filter_parts.append(f"[{i}:a]adelay={ms}:all=1[d{i}]")
        mix_inputs.append(f"[d{i}]")
    n = len(click_times) + 1
    filt = ";".join(filter_parts) + ";" + "".join(mix_inputs) + f"amix=inputs={n}:duration=first:normalize=0[aout]"
    cmd += ["-filter_complex", filt, "-map", "[aout]", "-c:a", "mp3", str(out_path)]
    run(cmd)


def build_hook(beat_dir):
    beat_dir.mkdir(parents=True, exist_ok=True)
    audio = ROOT / "audio" / "beat-00-hook.mp3"
    a_dur = adur(audio)
    video = beat_dir / "video.mp4"
    # Static frame, NO zoom/pan — held for the full narration length. A
    # Ken-Burns pan/zoom was tried on an earlier cut of this kind of video and
    # explicitly rejected by the client: it read as generic stock-footage
    # motion, not a demo of the app, and the user's fix list called it out by
    # name ("remove the zoom/pan"). Keep this beat genuinely static.
    run([
        "ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", str(ROOT / "assets" / "hero.png"),
        "-t", str(a_dur),
        "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}",
        "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video),
    ])
    final = beat_dir / "final.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(video), "-i", str(audio),
         "-c:v", "copy", "-c:a", "aac", "-shortest", str(final)])
    return final


def build_beat(beat_name, beat_dir):
    rec_dir = ROOT / "recordings" / beat_name
    manifest = json.loads((rec_dir / "manifest.json").read_text())
    click_wav = ROOT / "assets" / "click.wav"
    beat_dir.mkdir(parents=True, exist_ok=True)

    seg_finals = []
    for seg in manifest:
        idx = seg["index"]
        seg_rec_dir = rec_dir / seg["dir"]
        webms = list(seg_rec_dir.glob("*.webm"))
        if len(webms) != 1:
            raise RuntimeError(
                f"{seg_rec_dir} has {len(webms)} webm files, expected exactly 1 — "
                "a stale file from a prior recording run is almost always the "
                "cause; delete the old one (check `git ls-files` if unsure which "
                "is stale) before re-assembling."
            )
        webm = webms[0]
        click_data = json.loads((seg_rec_dir / "clicks.json").read_text())
        visible_start = click_data["visibleStart"]
        clicks = [round(c - visible_start, 3) for c in click_data["clicks"]]

        # Trim off the setup/replay prefix — recordVideo captures from
        # context creation, so everything before this segment's own visible
        # action (silently replaying prior segments' state) is on tape too.
        seg_video_raw = beat_dir / f"seg{idx:02d}_video_raw.mp4"
        run(["ffmpeg", "-y", "-v", "error", "-i", str(webm), "-ss", str(visible_start),
             "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", str(seg_video_raw)])

        seg_audio_raw = ROOT / "audio" / "segments" / beat_name / f"seg-{idx:02d}.mp3"
        seg_audio_wc = beat_dir / f"seg{idx:02d}_audio.mp3"
        mix_clicks(seg_audio_raw, clicks, click_wav, seg_audio_wc)

        v_dur = vdur(seg_video_raw)
        a_dur = adur(seg_audio_wc)
        seg_video_final = beat_dir / f"seg{idx:02d}_video.mp4"
        seg_audio_final = beat_dir / f"seg{idx:02d}_audiopad.mp3"
        if a_dur > v_dur + 0.03:
            # Voiceover runs longer than the action — freeze the last video
            # frame to stretch it, never speed up/slow down the voiceover.
            pad = a_dur - v_dur
            run(["ffmpeg", "-y", "-v", "error", "-i", str(seg_video_raw),
                 "-vf", f"tpad=stop_mode=clone:stop_duration={pad}",
                 "-c:v", "libx264", "-pix_fmt", "yuv420p", str(seg_video_final)])
            shutil.copyfile(seg_audio_wc, seg_audio_final)
        elif v_dur > a_dur + 0.03:
            # On-screen action runs longer — pad audio with silence instead
            # of trimming video (never cut off mid-action).
            pad = v_dur - a_dur
            run(["ffmpeg", "-y", "-v", "error", "-i", str(seg_audio_wc),
                 "-af", f"apad=pad_dur={pad}", "-c:a", "mp3", str(seg_audio_final)])
            shutil.copyfile(seg_video_raw, seg_video_final)
        else:
            shutil.copyfile(seg_video_raw, seg_video_final)
            shutil.copyfile(seg_audio_wc, seg_audio_final)

        seg_final = beat_dir / f"seg{idx:02d}_final.mp4"
        run(["ffmpeg", "-y", "-v", "error", "-i", str(seg_video_final), "-i", str(seg_audio_final),
             "-c:v", "copy", "-c:a", "aac", "-shortest", str(seg_final)])
        seg_finals.append(seg_final)

    beat_final = beat_dir / "final.mp4"
    if len(seg_finals) == 1:
        shutil.copyfile(seg_finals[0], beat_final)
    else:
        # Hard cut between segments within a beat — same continuous screen,
        # continuity is handled by record_demo.js's scroll/cursor restore, no
        # transition needed here. Crossfades are only between BEATS (below).
        inputs = []
        filt = ""
        for i, sf in enumerate(seg_finals):
            inputs += ["-i", str(sf)]
            filt += f"[{i}:v][{i}:a]"
        filt += f"concat=n={len(seg_finals)}:v=1:a=1[outv][outa]"
        run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", filt,
             "-map", "[outv]", "-map", "[outa]",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(beat_final)])
    return beat_final


def dip_transition_concat(clips, out_path, work_dir):
    """Join beats with a fade-through-FADE_COLOR dip, then a hard concat.

    Each clip is faded INDEPENDENTLY (out to the colour on its tail, in from the
    colour on its head), audio faded to and from silence the same way, and only
    then concatenated. Nothing overlaps. That is the whole design, and every part
    of it replaces something that failed on a real delivery:

    1. NOT xfade/acrossfade chains. Eight beats chained as 7 xfade+acrossfade
       pairs in one filter_complex rendered only the FIRST join as a real blend;
       every later join computed a correct offset and still came out a hard cut,
       with no error or warning. If you ever do reach for xfade, never put more
       than 2 inputs in one filter graph and materialise each intermediate to
       disk — but you shouldn't need it at all, because:
    2. A cross-dissolve is invisible here by construction. Each beat's setup()
       re-primes the app to the state the previous beat ended on (deliberately,
       for continuity), so the frames either side of a join are often
       near-identical — dissolving a frame into a copy of itself looks like
       nothing happened. Dipping through a colour is visible regardless of how
       similar the neighbours are.
    3. Overlapping two different narration clips sounds wrong. acrossfade
       between two unrelated speech waveforms produced an audible mid-transition
       volume dip whatever curve was used. Fading to silence and back cannot:
       there's only ever one voice audible.

    Because each clip's fade is timed off its own measured video-stream duration,
    there's no cumulative offset arithmetic to drift — which is the other half of
    why the old chained version was fragile.
    """
    if len(clips) == 1:
        shutil.copyfile(clips[0], out_path)
        return

    faded = []
    last = len(clips) - 1
    for i, clip in enumerate(clips):
        v_dur = vdur(clip)   # stream, not container — see vdur()'s docstring
        a_dur = adur(clip)
        vf, af = [], []
        if i > 0:
            vf.append(f"fade=t=in:st=0:d={FADE}:color={FADE_COLOR}")
            af.append(f"afade=t=in:st=0:d={FADE}")
        if i < last:
            vf.append(f"fade=t=out:st={max(0.0, v_dur - FADE):.3f}:d={FADE}:color={FADE_COLOR}")
            af.append(f"afade=t=out:st={max(0.0, a_dur - FADE):.3f}:d={FADE}")
        # setsar=1 unconditionally, on every clip, even ones getting no fade.
        # A clip built from a scaled/cropped still (the hook beat) can come out
        # of a fade with a non-1:1 SAR — 12325:12327 on a real run — and concat
        # then fails with the unhelpful "Input link parameters do not match".
        # Normalising every clip means the concat below can't hit a mismatch.
        vf.append("setsar=1")
        out = Path(work_dir) / f"dip{i:02d}.mp4"
        run(["ffmpeg", "-y", "-v", "error", "-i", str(clip),
             "-vf", ",".join(vf), *(["-af", ",".join(af)] if af else []),
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(out)])
        faded.append(out)

    inputs, filt = [], ""
    for i, f in enumerate(faded):
        inputs += ["-i", str(f)]
        filt += f"[{i}:v][{i}:a]"
    filt += f"concat=n={len(faded)}:v=1:a=1[outv][outa]"
    run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", filt,
         "-map", "[outv]", "-map", "[outa]",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(out_path)])


def main():
    out_path = Path(sys.argv[1])
    beat_names = sys.argv[2:]
    BUILD.mkdir(exist_ok=True)

    finals = []
    for name in beat_names:
        beat_dir = BUILD / name
        if name == "00-hook":
            finals.append(build_hook(beat_dir))
        else:
            finals.append(build_beat(name, beat_dir))
        print(f"beat {name}: {container_dur(finals[-1]):.2f}s")

    dip_transition_concat(finals, out_path, BUILD)
    print(f"=== {out_path} : {container_dur(out_path):.2f}s ===")


if __name__ == "__main__":
    main()
