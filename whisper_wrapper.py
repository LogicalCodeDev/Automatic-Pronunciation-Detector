import torch
from transformers import pipeline
from ModelInterfaces import IASRModel
from typing import Union
import numpy as np


class WhisperASRModel(IASRModel):
    """
    Whisper wrapper using Hugging Face pipeline.

    Key fixes vs original:
    - Force language correctly via generate_kwargs (NOT as a raw pipeline kwarg).
      The raw 'language=' kwarg is not supported by the pipeline's __call__; it
      must be passed inside generate_kwargs so it reaches model.generate().
    - Task is always 'transcribe' (not 'translate') so we get source-language text.
    - Graceful handling of missing timestamps (returns sensible defaults).

    Args:
        model_name:     HuggingFace model id, e.g. "openai/whisper-small"
        force_language: BCP-47 language code, e.g. 'en', 'hi', 'mr'
        device:         -1 for CPU, 0 for first GPU, etc.
    """

    def __init__(
        self,
        model_name: str = "openai/whisper-base",
        force_language: str = None,
        device: int = -1,
    ):
        self.force_language = force_language
        self.sample_rate = 16000
        self._transcript = ""
        self._word_locations = []

        self.asr = pipeline(
            "automatic-speech-recognition",
            model=model_name,
            device=device,
            return_timestamps="word",
            chunk_length_s=30,          # handle long audio gracefully
            stride_length_s=[5, 5],     # overlap at chunk boundaries
        )

    # ------------------------------------------------------------------
    def processAudio(self, audio: Union[np.ndarray, "torch.Tensor"]):
        """
        Transcribe audio and store transcript + word timestamps.

        audio: torch.Tensor of shape (1, samples) or (samples,), or a numpy
               array of the same shapes.  Sample rate must be 16 kHz.
        """
        try:
            # ── 1. Normalise input to 1-D numpy float32 ────────────────
            if hasattr(audio, "detach"):
                audio = audio.detach().cpu().numpy()
            audio = np.array(audio, dtype=np.float32)
            if audio.ndim == 2:
                audio = audio[0]          # (1, N) → (N,)
            elif audio.ndim != 1:
                raise ValueError(f"Unexpected audio shape: {audio.shape}")

            # ── 2. Build generate_kwargs to force language + transcribe ─
            #    NOTE: passing language= directly to pipeline() __call__
            #    is NOT supported in recent transformers; it must go into
            #    generate_kwargs so it reaches model.generate().
            generate_kwargs = {"task": "transcribe"}
            if self.force_language:
                generate_kwargs["language"] = self.force_language

            # ── 3. Run the pipeline ─────────────────────────────────────
            result = self.asr(audio, generate_kwargs=generate_kwargs)

            # ── 4. Extract transcript ───────────────────────────────────
            self._transcript = (result.get("text") or "").strip()

            # ── 5. Extract word-level timestamps ───────────────────────
            raw_chunks = result.get("chunks") or []
            self._word_locations = []

            for chunk in raw_chunks:
                if not isinstance(chunk, dict):
                    continue

                word  = (chunk.get("text") or chunk.get("word") or "").strip()
                ts    = chunk.get("timestamp")

                # Timestamps arrive as a tuple (start, end) in seconds.
                # Either value can be None (e.g. at the very end of audio).
                try:
                    start_s = float(ts[0]) if (ts and ts[0] is not None) else 0.0
                except Exception:
                    start_s = 0.0

                try:
                    end_s = float(ts[1]) if (ts and ts[1] is not None) else start_s + 0.2
                except Exception:
                    end_s = start_s + 0.2

                # Convert seconds → sample indices (used by pronunciationTrainer)
                self._word_locations.append({
                    "word":     word,
                    "start_ts": start_s * self.sample_rate,
                    "end_ts":   end_s   * self.sample_rate,
                })

        except Exception as exc:
            print(f"[WhisperASRModel] processAudio error: {exc!r}")
            raise

    # ------------------------------------------------------------------
    def getTranscript(self) -> str:
        return self._transcript

    def getWordLocations(self) -> list:
        return self._word_locations