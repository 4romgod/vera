import json
from threading import Thread
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from vera_pocket_tts.contracts import ContractError, parse_synthesis_request
from vera_pocket_tts.engine import DeterministicSpeechEngine
from vera_pocket_tts.server import SpeechHttpServer, SpeechRequestHandler


class ContractTests(unittest.TestCase):
    def test_parses_closed_versioned_request(self) -> None:
        request = parse_synthesis_request(
            json.dumps(
                {"schemaVersion": 1, "text": " Hello. ", "voiceId": "alba"}
            ).encode(),
            frozenset({"alba"}),
        )
        self.assertEqual(request.text, "Hello.")
        self.assertEqual(request.voice_id, "alba")

    def test_rejects_unknown_fields_and_unapproved_voice(self) -> None:
        with self.assertRaises(ContractError):
            parse_synthesis_request(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "text": "Hello.",
                        "voiceId": "alba",
                        "url": "https://example.invalid/voice.wav",
                    }
                ).encode(),
                frozenset({"alba"}),
            )
        with self.assertRaises(ContractError):
            parse_synthesis_request(
                json.dumps(
                    {"schemaVersion": 1, "text": "Hello.", "voiceId": "other"}
                ).encode(),
                frozenset({"alba"}),
            )


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = SpeechHttpServer(
            ("127.0.0.1", 0), DeterministicSpeechEngine(), frozenset({"alba"})
        )
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_health_readiness_and_synthesis(self) -> None:
        with urlopen(f"{self.base_url}/health", timeout=2) as response:
            self.assertEqual(json.load(response)["status"], "ok")
        with urlopen(f"{self.base_url}/ready", timeout=2) as response:
            ready = json.load(response)
            self.assertEqual(ready["status"], "ready")
            self.assertEqual(ready["voices"], ["alba"])

        body = json.dumps(
            {"schemaVersion": 1, "text": "Hello from Vera.", "voiceId": "alba"}
        ).encode()
        request = Request(
            f"{self.base_url}/v1/speech",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urlopen(request, timeout=2) as response:
            audio = response.read()
            self.assertEqual(response.headers["Content-Type"], "audio/wav")
            self.assertEqual(response.headers["X-Vera-Speech-Model"], "deterministic-speech-v1")
            self.assertTrue(audio.startswith(b"RIFF"))

    def test_rejects_unknown_fields_without_synthesizing(self) -> None:
        body = json.dumps(
            {
                "schemaVersion": 1,
                "text": "Hello.",
                "voiceId": "alba",
                "unexpected": True,
            }
        ).encode()
        request = Request(
            f"{self.base_url}/v1/speech",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with self.assertRaises(HTTPError) as raised:
            urlopen(request, timeout=2)
        self.assertEqual(raised.exception.code, 422)


if __name__ == "__main__":
    unittest.main()
