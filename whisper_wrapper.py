import torch 
from transformers import pipeline
from ModelInterfaces import IASRModel
from typing import Union
import numpy as np 
import tempfile
import os

class WhisperASRModel(IASRModel):
    """
    Whisper wrapper using Hugging Face pipeline.
    - model_name: e.g. "openai/whisper-small"
    - force_language: 'en'|'de' etc. (passed to pipeline call if supported)
    - device: -1 for CPU, or integer GPU index for CUDA
    """

    def __init__(self, model_name="openai/whisper-base", force_language: str = None, device: int = -1):
        self.force_language = force_language
        # device argument accepted by HF pipeline: -1 -> CPU, 0 -> GPU0, etc.
        self.asr = pipeline(
            "automatic-speech-recognition",
            model=model_name,
            device=device,
            return_timestamps="word"
        )
        self._transcript = ""
        self._word_locations = []  # list of dicts: {'word','start_ts','end_ts'}
        self.sample_rate = 16000

    def processAudio(self, audio: Union[np.ndarray, 'torch.Tensor']):
        # Accept audio as torch tensor or numpy. Expect shape (1, samples) or (samples,)
        try:
            # convert to numpy 1D array
            if hasattr(audio, 'detach'):
                audio = audio.detach().cpu().numpy()
            audio_arr = audio[0] if (hasattr(audio, 'ndim') and audio.ndim == 2) else audio

            # prepare kwargs: force language if provided
            kwargs = {}
            if self.force_language:
                kwargs['language'] = self.force_language

            # run pipeline
            result = self.asr(audio_arr, **kwargs)

            # store transcript
            self._transcript = result.get("text", "")

            # Extract word-level timestamps robustly
            chunks = result.get("chunks") or result.get("segments") or []
            word_candidates = []
            for c in chunks:
                # if chunk has nested 'words', expand them
                if isinstance(c, dict) and 'words' in c and isinstance(c['words'], list):
                    for w in c['words']:
                        word_candidates.append(w)
                else:
                    # sometimes c is a dict with 'text' and 'timestamp'
                    word_candidates.append(c)

            # normalize word entries to expected structure
            self._word_locations = []
            for w in word_candidates:
                if isinstance(w, dict):
                    text = w.get("text") or w.get("word") or ""
                    ts = w.get("timestamp") or (w.get("start"), w.get("end"))
                    # fallback if timestamp is stored differently
                    if ts is None:
                        start = float(w.get("start", 0.0))
                        end = float(w.get("end", start + 0.01))
                    else:
                        # some entries use tuples, some lists
                        try:
                            start = float(ts[0]) if ts[0] is not None else 0.0
                        except Exception:
                            start = 0.0
                        try:
                            end = float(ts[1]) if ts[1] is not None else start + 0.01
                        except Exception:
                            end = start + 0.01
                else:
                    # fallback: unknown structure -> skip
                    continue

                # convert seconds to sample indices (float)
                start_sample = start * self.sample_rate
                end_sample = end * self.sample_rate
                self._word_locations.append({
                    "word": text.strip(),
                    "start_ts": start_sample,
                    "end_ts": end_sample
                })
        except Exception as e:
            # keep previous state safe, but log error to console
            print("[WhisperASRModel] processAudio error:", repr(e))
            # re-raise to let upper layer handle it if desired
            raise

    def getTranscript(self) -> str:
        assert self._transcript is not None, "Call processAudio() first"
        return self._transcript

    def getWordLocations(self) -> list:
        assert self._word_locations is not None, "Call processAudio() first"
        return self._word_locations


# class WhisperASRModel(IASRModel):
#     def __init__(self, model_name="openai/whisper-base"):
#         self.asr = pipeline("automatic-speech-recognition", model=model_name, return_timestamps="word")
#         self._transcript = ""
#         self._word_locations = []
#         self.sample_rate = 16000

#     def processAudio(self, audio:Union[np.ndarray, torch.Tensor]):
#         # 'audio' can be a path to a file or a numpy array of audio samples.
#         if isinstance(audio, torch.Tensor):
#             audio = audio.detach().cpu().numpy()
#         result = self.asr(audio[0])
#         self._transcript = result["text"]
#         self._word_locations = [{"word": word_info["text"], 
#                      "start_ts": word_info["timestamp"][0] * self.sample_rate if word_info["timestamp"][0] is not None else None,
#                      "end_ts": (word_info["timestamp"][1] * self.sample_rate if word_info["timestamp"][1] is not None else (word_info["timestamp"][0] + 1) * self.sample_rate),
#                      "tag": "processed"} for word_info in result["chunks"]]

#     def getTranscript(self) -> str:
#         return self._transcript

#     def getWordLocations(self) -> list:
        
#         return self._word_locations
