"""Pocket TTS engine boundary and deterministic test implementation."""

from array import array
from dataclasses import dataclass
from io import BytesIO
from threading import Lock
from typing import Protocol
import wave


@dataclass(frozen=True)
class SynthesizedSpeech:
    wav: bytes
    sample_rate: int


class SpeechEngine(Protocol):
    @property
    def model(self) -> str: ...

    def synthesize(self, text: str, voice_id: str) -> SynthesizedSpeech: ...


def encode_mono_pcm_wave(samples: bytes, sample_rate: int) -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(samples)
    return output.getvalue()


class PocketTtsEngine:
    """Keeps one model and bounded set of voice states resident in memory."""

    def __init__(self, allowed_voices: frozenset[str], language: str = "english") -> None:
        try:
            from pocket_tts import TTSModel
        except ImportError as error:
            raise RuntimeError(
                "Pocket TTS is not installed. Run npm run vera:install."
            ) from error
        self._model_name = f"pocket-tts-3.1.0:{language}"
        self._model = TTSModel.load_model(language=language)
        self._voice_states = {
            voice: self._model.get_state_for_audio_prompt(voice)
            for voice in sorted(allowed_voices)
        }
        self._lock = Lock()

    @property
    def model(self) -> str:
        return self._model_name

    def synthesize(self, text: str, voice_id: str) -> SynthesizedSpeech:
        # The upstream model is stateful. Serialize generation until Pocket TTS
        # explicitly guarantees concurrent use of one loaded model instance.
        with self._lock:
            audio = self._model.generate_audio(self._voice_states[voice_id], text)
            # Converting through Python integers is slightly slower than a raw
            # torch cast, but avoids importing a private Pocket TTS dependency.
            samples = array(
                "h",
                (
                    round(max(-1.0, min(1.0, float(value))) * 32767)
                    for value in audio.detach().cpu()
                ),
            )
            return SynthesizedSpeech(
                wav=encode_mono_pcm_wave(samples.tobytes(), self._model.sample_rate),
                sample_rate=self._model.sample_rate,
            )


class DeterministicSpeechEngine:
    """Small valid-WAV engine used by contract tests and operator diagnostics."""

    model = "deterministic-speech-v1"

    def synthesize(self, text: str, voice_id: str) -> SynthesizedSpeech:
        del text, voice_id
        sample_rate = 8_000
        samples = array("h", [0] * 80)
        return SynthesizedSpeech(
            wav=encode_mono_pcm_wave(samples.tobytes(), sample_rate),
            sample_rate=sample_rate,
        )
