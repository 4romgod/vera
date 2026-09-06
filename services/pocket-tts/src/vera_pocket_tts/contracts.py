"""Versioned wire-contract parsing for the local speech service."""

from dataclasses import dataclass
import json
import re
from typing import Any


MAX_TEXT_CHARACTERS = 20_000
MAX_REQUEST_BYTES = 80_000
VOICE_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")


class ContractError(ValueError):
    """Raised when an untrusted request does not satisfy the closed contract."""


@dataclass(frozen=True)
class SynthesisRequest:
    text: str
    voice_id: str


def parse_synthesis_request(payload: bytes, allowed_voices: frozenset[str]) -> SynthesisRequest:
    if len(payload) > MAX_REQUEST_BYTES:
        raise ContractError("The speech request is too large.")
    try:
        value: Any = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ContractError("The speech request must be valid JSON.") from error
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "text", "voiceId"}:
        raise ContractError("The speech request does not match schema version 1.")
    if value["schemaVersion"] != 1:
        raise ContractError("The speech request does not match schema version 1.")
    text = value["text"]
    voice_id = value["voiceId"]
    if not isinstance(text, str):
        raise ContractError("Speech text must be a string.")
    text = text.strip()
    if not text:
        raise ContractError("Speech text must not be empty.")
    if len(text) > MAX_TEXT_CHARACTERS:
        raise ContractError("Speech text is too long.")
    if not isinstance(voice_id, str) or VOICE_ID_PATTERN.fullmatch(voice_id) is None:
        raise ContractError("The voice identifier is invalid.")
    if voice_id not in allowed_voices:
        raise ContractError("The requested voice is not allowed by this service.")
    return SynthesisRequest(text=text, voice_id=voice_id)
