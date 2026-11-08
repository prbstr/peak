#!/usr/bin/env python3
"""Kokoro on the Mac: how soon the first sound comes, how fast it speaks, what it costs in memory.

Run from mind/: voice/.venv-kokoro/bin/python voice/kokoro_bench.py [--play] [--runs 3]
  --play   also plays each line on the Mac's default output, through local.py's player, and times the first sample
           at the speaker (the audio device's own clock)
  --voice  Kokoro voice (default PEAK_KOKORO_VOICE or bm_george); the first letter picks the accent (a US, b UK)

Each line is made two ways: whole, and in local.py's pieces (one per sentence, a long first sentence cut in two
at a comma or a joining word), because the first audio comes when the first piece is made. Both are trimmed of Kokoro's silent pads as
local.py does. The gate for using Kokoro at all: first sound within 0.5 s.
"""
import argparse, os, resource, statistics, sys, time

import mlx.core as mx
import psutil

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import local  # noqa: E402

# Rho-length lines: one to three short sentences, like the brain's replies; two carry words missing from misaki's
# dictionary (Rho, GeekServos), which only espeak can sound out, and the last is one long sentence
LINES = [
    "Hey! Good to see you.",
    "Lights off. Sleep well.",
    "Two plus two is four. Easy one.",
    "I'm Rho. My GeekServos are still on their way, so no waving yet.",
    "That looks like a soldering iron. Careful, the tip gets hot enough to hurt. Want me to keep an eye on it?",
    "Sure, I'll keep the desk light on for you until you are done with the soldering tonight.",
]
CUTS = (("whole line", lambda text: [text]), ("pieces", local.cut))


def rss_mb():
    return psutil.Process().memory_info().rss / 2**20


def run(model, text, voice, cutter, player):
    """Seconds to the first audio piece, to the last, seconds of audio, and seconds to the first sound when played."""
    t0 = time.monotonic()
    first = None
    audio_s = 0.0
    if player:
        player.start_line()
    for a in local.pieces(model, text, voice, cutter):
        if first is None:
            first = time.monotonic() - t0
        audio_s += len(a) / model.sample_rate
        if player:
            player.add(a)
    made = time.monotonic() - t0
    sound = None
    if player:
        player.wait_heard()
        sound = player.first_sound_at - t0
        time.sleep(0.3)
    return first, made, audio_s, sound


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--play", action="store_true")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--voice", default=local.VOICE)
    args = ap.parse_args()

    base = rss_mb()
    local.espeak_from_wheel()
    from mlx_audio.tts.utils import load_model
    t = time.monotonic()
    model = load_model(local.model_path(), model_type="kokoro")
    load_s = time.monotonic() - t
    t = time.monotonic()
    list(model.generate("Ready.", voice=args.voice, lang_code=args.voice[0]))
    warm_s = time.monotonic() - t
    print(f"model {local.MODEL}, voice {args.voice}: load {load_s:.1f}s, first line (cold) {warm_s:.1f}s, "
          f"RSS {base:.0f} -> {rss_mb():.0f} MB, MLX active {mx.get_active_memory() / 2**20:.0f} MB")
    player = local.Player(model.sample_rate) if args.play else None
    if player:
        print(f"output {player.device!r}, stream latency {player.stream.latency * 1000:.0f} ms")

    rows = [(cut, text, *run(model, text, args.voice, cutter, player))
            for cut, cutter in CUTS for text in LINES for _ in range(args.runs)]

    print(f"\n| cut | line | chars | first audio s | first sound s | made s | audio s | RTF |  (median of {args.runs})")
    print("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for cut, _ in CUTS:
        for text in LINES:
            rs = [r for r in rows if r[0] == cut and r[1] == text]
            med = lambda i: statistics.median(r[i] for r in rs)
            sound = f"{med(5):.2f}" if player else "-"
            short = text if len(text) <= 40 else text[:37] + "..."
            print(f"| {cut} | {short} | {len(text)} | {med(2):.2f} | {sound} | {med(3):.2f} | {med(4):.1f} | "
                  f"{med(3) / med(4):.3f} |")
    print()
    for cut, _ in CUTS:
        rs = [r for r in rows if r[0] == cut]
        firsts = sorted(r[2] for r in rs)
        line = f"{cut}: first audio p50 {statistics.median(firsts):.2f}s max {firsts[-1]:.2f}s"
        if player:
            sounds = sorted(r[5] for r in rs)
            line += f"; first sound p50 {statistics.median(sounds):.2f}s max {sounds[-1]:.2f}s"
        rtf = sum(r[3] for r in rs) / sum(r[4] for r in rs)
        print(f"{line}; RTF {rtf:.3f} (made / audio, all lines)")
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20  # bytes on macOS
    print(f"after {len(rows)} lines: RSS {rss_mb():.0f} MB, RSS peak {peak:.0f} MB, "
          f"MLX active {mx.get_active_memory() / 2**20:.0f} MB, MLX peak {mx.get_peak_memory() / 2**20:.0f} MB")


if __name__ == "__main__":
    main()
