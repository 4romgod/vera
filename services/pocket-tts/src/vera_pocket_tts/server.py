"""Loopback HTTP boundary for Vera's local Pocket TTS process."""

from argparse import ArgumentParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from typing import Callable
from urllib.parse import urlsplit

from .contracts import ContractError, MAX_REQUEST_BYTES, parse_synthesis_request
from .engine import DeterministicSpeechEngine, PocketTtsEngine, SpeechEngine


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8091
DEFAULT_VOICES = "alba,anna"


class SpeechHttpServer(ThreadingHTTPServer):
    def __init__(
        self,
        address: tuple[str, int],
        engine: SpeechEngine,
        allowed_voices: frozenset[str],
    ) -> None:
        super().__init__(address, SpeechRequestHandler)
        self.engine = engine
        self.allowed_voices = allowed_voices


class SpeechRequestHandler(BaseHTTPRequestHandler):
    server: SpeechHttpServer
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        path = urlsplit(self.path)
        if path.query or path.fragment:
            self._json_error(HTTPStatus.NOT_FOUND, "not_found", "Route not found.")
            return
        if path.path == "/health":
            self._json(HTTPStatus.OK, {"status": "ok", "service": "vera-pocket-tts"})
            return
        if path.path == "/ready":
            self._json(
                HTTPStatus.OK,
                {
                    "status": "ready",
                    "service": "vera-pocket-tts",
                    "model": self.server.engine.model,
                    "voices": sorted(self.server.allowed_voices),
                },
            )
            return
        self._json_error(HTTPStatus.NOT_FOUND, "not_found", "Route not found.")

    def do_POST(self) -> None:
        path = urlsplit(self.path)
        if path.path != "/v1/speech" or path.query or path.fragment:
            self._json_error(HTTPStatus.NOT_FOUND, "not_found", "Route not found.")
            return
        if self.headers.get_content_type() != "application/json":
            self._json_error(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                "content_type_unsupported",
                "Content-Type must be application/json.",
            )
            return
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_REQUEST_BYTES:
            self._json_error(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "request_too_large",
                "The speech request is too large.",
            )
            return
        try:
            request = parse_synthesis_request(
                self.rfile.read(length), self.server.allowed_voices
            )
            result = self.server.engine.synthesize(request.text, request.voice_id)
        except ContractError as error:
            self._json_error(HTTPStatus.UNPROCESSABLE_ENTITY, "request_invalid", str(error))
            return
        except Exception:
            self._json_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "synthesis_failed",
                "The speech engine could not synthesize this request.",
            )
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(result.wav)))
        self.send_header("X-Vera-Speech-Model", self.server.engine.model)
        self.send_header("X-Vera-Speech-Sample-Rate", str(result.sample_rate))
        self.end_headers()
        self.wfile.write(result.wav)

    def log_message(self, format: str, *args: object) -> None:
        # Do not log request bodies or provider output. The standard access line
        # remains useful for local diagnostics without exposing spoken text.
        super().log_message(format, *args)

    def _json(self, status: HTTPStatus, body: dict[str, object]) -> None:
        payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _json_error(
        self, status: HTTPStatus, code: str, message: str
    ) -> None:
        self._json(status, {"error": {"code": code, "message": message}})


def parse_allowed_voices(value: str) -> frozenset[str]:
    voices = frozenset(part.strip() for part in value.split(",") if part.strip())
    if not voices:
        raise ValueError("POCKET_TTS_ALLOWED_VOICES must contain at least one voice.")
    return voices


def create_engine(kind: str, voices: frozenset[str], language: str) -> SpeechEngine:
    if kind == "deterministic":
        return DeterministicSpeechEngine()
    if kind == "pocket_tts":
        return PocketTtsEngine(voices, language)
    raise ValueError(f"Unknown speech engine: {kind}")


def run_server(
    host: str,
    port: int,
    engine: SpeechEngine,
    voices: frozenset[str],
    on_ready: Callable[[SpeechHttpServer], None] | None = None,
) -> None:
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise ValueError("The Pocket TTS service must bind to loopback.")
    server = SpeechHttpServer((host, port), engine, voices)
    if on_ready is not None:
        on_ready(server)
    try:
        server.serve_forever()
    finally:
        server.server_close()


def main() -> None:
    parser = ArgumentParser(description="Run Vera's loopback Pocket TTS service.")
    parser.add_argument("--host", default=os.environ.get("POCKET_TTS_HOST", DEFAULT_HOST))
    parser.add_argument(
        "--port", type=int, default=int(os.environ.get("POCKET_TTS_PORT", DEFAULT_PORT))
    )
    parser.add_argument(
        "--engine", choices=("pocket_tts", "deterministic"),
        default=os.environ.get("POCKET_TTS_ENGINE", "pocket_tts"),
    )
    parser.add_argument(
        "--language", default=os.environ.get("POCKET_TTS_LANGUAGE", "english")
    )
    arguments = parser.parse_args()
    voices = parse_allowed_voices(
        os.environ.get("POCKET_TTS_ALLOWED_VOICES", DEFAULT_VOICES)
    )
    engine = create_engine(arguments.engine, voices, arguments.language)
    run_server(arguments.host, arguments.port, engine, voices)


if __name__ == "__main__":
    main()
