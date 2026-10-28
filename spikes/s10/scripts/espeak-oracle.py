"""Dev-time oracle: Vietnamese/English text -> Piper's espeak-ng phonemes. Never shipped.

Reads {"voice": "vi", "texts": [...]} on stdin and prints {"phonemizer": ..., "phonemes": [[sentence, ...], ...]}.
Uses piper_phonemize 1.1.0 (the phonemizer Piper voices were trained with) when importable, else piper-tts's
espeakbridge. Both are GPL (espeak-ng); they live only in .cache/s10/ virtualenvs.
"""

import json
import sys

req = json.load(sys.stdin)
voice = req["voice"]
out = []
try:
    from piper_phonemize import phonemize_espeak

    name = "piper_phonemize==1.1.0"
    for t in req["texts"]:
        out.append(["".join(s) for s in phonemize_espeak(t, voice)])
except ImportError:
    from importlib.metadata import version

    from piper.phonemize_espeak import EspeakPhonemizer

    name = "piper-tts==" + version("piper-tts")
    p = EspeakPhonemizer()
    for t in req["texts"]:
        out.append(["".join(s) for s in p.phonemize(voice, t)])
json.dump({"phonemizer": name, "phonemes": out}, sys.stdout, ensure_ascii=False)
