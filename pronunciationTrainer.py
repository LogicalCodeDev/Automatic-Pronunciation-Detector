import torch
import numpy as np
import models as mo
import WordMetrics
import WordMatching as wm
import ModelInterfaces as mi
import AIModels
import RuleBasedModels
from string import punctuation
import time
import difflib

# ─────────────────────────────────────────────────────────────────────────────
# Module-level trainer cache — one trainer per language, loaded lazily.
# This prevents reloading the heavy Whisper model on every HTTP request.
# ─────────────────────────────────────────────────────────────────────────────
_trainer_cache: dict = {}


def getTrainer(language: str) -> "PronunciationTrainer":
    """
    Return a cached PronunciationTrainer for the given language.
    Constructs and caches on first call per language; subsequent calls are O(1).
    """
    if language not in _trainer_cache:
        _trainer_cache[language] = _buildTrainer(language)
    return _trainer_cache[language]


def _buildTrainer(language: str) -> "PronunciationTrainer":
    """Internal factory — only called once per language."""
    asr_model = mo.getASRModel(language, use_whisper=True)

    if language == "en":
        phonem_converter = RuleBasedModels.EngPhonemConverter()
    elif language == "hi":
        phonem_converter = RuleBasedModels.HindiIPA()
    elif language == "mr":
        phonem_converter = RuleBasedModels.MarathiIPA()
    else:
        raise ValueError(f"Language not supported: {language!r}")

    return PronunciationTrainer(asr_model, phonem_converter)


# ─────────────────────────────────────────────────────────────────────────────
class PronunciationTrainer:
    """
    Core pronunciation evaluation pipeline.

    Changes vs. original:
    - categories_thresholds corrected to [80, 60, 40] (was [80, 60, 59] — a
      near-identical pair that made the 'medium' and 'poor' categories overlap).
    - getPronunciationAccuracy and fuzzy_map_words are proper instance methods.
    - preprocessAudio guards against near-silence to avoid divide-by-zero.
    """

    current_transcript: str
    current_ipa: str
    current_recorded_audio: torch.Tensor
    current_recorded_transcript: str
    current_recorded_word_locations: list
    current_recorded_intonations: torch.Tensor
    current_words_pronunciation_accuracy: list

    # Thresholds: if accuracy ≥ threshold → category 0 (good),
    #             if accuracy ≥ next → category 1 (ok), else → category 2 (bad)
    #   Fixed: was [80, 60, 59] which made ok/bad nearly identical.
    categories_thresholds = np.array([80, 60, 40])

    sampling_rate = 16_000

    def __init__(
        self,
        asr_model: mi.IASRModel,
        word_to_ipa_converter: mi.ITextToPhonemModel,
    ) -> None:
        self.asr_model = asr_model
        self.ipa_converter = word_to_ipa_converter

    # ── Main entry point ────────────────────────────────────────────────────
    def processAudioForGivenText(
        self,
        recordedAudio: torch.Tensor = None,
        real_text: str = None,
    ) -> dict:
        t0 = time.time()
        recording_transcript, recording_ipa, word_locations = self.getAudioTranscript(recordedAudio)
        print(f"[PT] ASR time: {time.time()-t0:.2f}s")

        t0 = time.time()
        real_and_transcribed_words, real_and_transcribed_words_ipa, mapped_words_indices = \
            self.matchSampleAndRecordedWords(real_text, recording_transcript)
        print(f"[PT] Matching time: {time.time()-t0:.2f}s")

        start_time, end_time = self.getWordLocationsFromRecordInSeconds(
            word_locations, mapped_words_indices
        )

        pronunciation_accuracy, current_words_pronunciation_accuracy = \
            self.getPronunciationAccuracy(real_and_transcribed_words_ipa)

        pronunciation_categories = self.getWordsPronunciationCategory(
            current_words_pronunciation_accuracy
        )

        return {
            "recording_transcript":         recording_transcript,
            "real_and_transcribed_words":   real_and_transcribed_words,
            "recording_ipa":                recording_ipa,
            "start_time":                   start_time,
            "end_time":                     end_time,
            "real_and_transcribed_words_ipa": real_and_transcribed_words_ipa,
            "pronunciation_accuracy":       pronunciation_accuracy,
            "pronunciation_categories":     pronunciation_categories,
        }

    # ── ASR ─────────────────────────────────────────────────────────────────
    def getAudioTranscript(self, recordedAudio: torch.Tensor):
        audio = self.preprocessAudio(recordedAudio)
        self.asr_model.processAudio(audio)
        transcript, word_locations = self.getTranscriptAndWordsLocations(audio.shape[1])
        ipa = self.ipa_converter.convertToPhonem(transcript)
        return transcript, ipa, word_locations

    def getTranscriptAndWordsLocations(self, audio_length_in_samples: int):
        transcript = self.asr_model.getTranscript()
        raw_locations = self.asr_model.getWordLocations()

        fade = int(0.05 * self.sampling_rate)
        word_locations = [
            (
                max(0, int(w["start_ts"]) - fade),
                min(audio_length_in_samples - 1, int(w["end_ts"]) + fade),
            )
            for w in raw_locations
        ]
        return transcript, word_locations

    # ── Matching ─────────────────────────────────────────────────────────────
    def matchSampleAndRecordedWords(self, real_text: str, recorded_transcript: str):
        words_estimated = recorded_transcript.split()
        words_real = real_text.split() if real_text else getattr(self, "current_transcript", [""])[0].split()

        # Primary: DTW word alignment
        try:
            mapped_words, mapped_words_indices = wm.get_best_mapped_words(
                words_estimated, words_real
            )
        except Exception as ex:
            print(f"[PT WARN] DTW mapping failed: {ex!r}")
            mapped_words = ["-"] * len(words_real)
            mapped_words_indices = [0] * len(words_real)

        # Fallback: fuzzy mapping when DTW leaves too many gaps
        gap_fraction = sum(1 for w in mapped_words if w == "-") / max(1, len(mapped_words))
        if gap_fraction > 0.4 or len(mapped_words) < len(words_real):
            print("[PT WARN] Many gaps — using fuzzy fallback")
            mapped_words = self._fuzzy_map_words(words_estimated, words_real)
            mapped_words_indices = self._build_index_list(mapped_words, words_estimated)

        # Build output pairs
        real_and_transcribed_words = []
        real_and_transcribed_words_ipa = []

        for i, real_word in enumerate(words_real):
            mapped = mapped_words[i] if i < len(mapped_words) else "-"
            real_ipa   = self.ipa_converter.convertToPhonem(real_word)
            mapped_ipa = self.ipa_converter.convertToPhonem(mapped) if mapped != "-" else "-"
            real_and_transcribed_words.append((real_word, mapped))
            real_and_transcribed_words_ipa.append((real_ipa, mapped_ipa))

        return real_and_transcribed_words, real_and_transcribed_words_ipa, mapped_words_indices

    def _fuzzy_map_words(self, estimated_words: list, real_words: list, cutoff: float = 0.35) -> list:
        """Map each real word to the best-matching estimated word by string similarity."""
        mapped = []
        for real in real_words:
            best, best_score = "-", 0.0
            for est in estimated_words:
                score = difflib.SequenceMatcher(None, real.lower(), est.lower()).ratio()
                if score > best_score:
                    best, best_score = est, score
            mapped.append(best if best_score >= cutoff else "-")
        return mapped

    def _build_index_list(self, mapped_words: list, estimated_words: list) -> list:
        """For each mapped word, find its index in estimated_words (monotone search)."""
        indices = []
        last = 0
        for mw in mapped_words:
            if mw == "-" or not estimated_words:
                indices.append(0)
                continue
            idx = next(
                (i for i in range(last, len(estimated_words)) if estimated_words[i].lower() == mw.lower()),
                next(
                    (i for i in range(0, last) if estimated_words[i].lower() == mw.lower()),
                    0,
                ),
            )
            indices.append(idx)
            last = max(0, idx)
        return indices

    # ── Accuracy ─────────────────────────────────────────────────────────────
    def getPronunciationAccuracy(self, real_and_transcribed_words_ipa: list):
        """
        Compute overall and per-word pronunciation accuracy (phoneme edit distance).
        Returns (overall_pct_float, [per_word_pct, ...]).
        """
        total_mismatches = 0.0
        total_phonemes = 0
        per_word = []

        for real_ipa_raw, trans_ipa_raw in real_and_transcribed_words_ipa:
            real_ipa  = self.removePunctuation(real_ipa_raw or "").lower()
            trans_ipa = self.removePunctuation(trans_ipa_raw or "").lower()

            if not real_ipa:
                per_word.append(0.0)
                continue

            try:
                mismatches = WordMetrics.edit_distance_python(real_ipa, trans_ipa)
            except Exception as ex:
                print(f"[PT WARN] edit_distance failed for '{real_ipa}'/'{trans_ipa}': {ex!r}")
                mismatches = max(len(real_ipa), len(trans_ipa))

            n = len(real_ipa)
            total_phonemes   += n
            total_mismatches += mismatches

            word_acc = max(0.0, min(100.0, (n - mismatches) / n * 100.0))
            per_word.append(word_acc)

        if total_phonemes == 0:
            overall = 0.0
        else:
            overall = max(0.0, min(100.0, (total_phonemes - total_mismatches) / total_phonemes * 100.0))

        return float(np.round(overall)), per_word

    # ── Categories ──────────────────────────────────────────────────────────
    def getWordsPronunciationCategory(self, accuracies: list) -> list:
        return [self.getPronunciationCategoryFromAccuracy(a) for a in accuracies]

    def getPronunciationCategoryFromAccuracy(self, accuracy: float) -> int:
        return int(np.argmin(np.abs(self.categories_thresholds - accuracy)))

    # ── Intonation ──────────────────────────────────────────────────────────
    def getWordsRelativeIntonation(self, audio: torch.Tensor, word_locations: list) -> torch.Tensor:
        intonations = torch.zeros(len(word_locations), 1)
        fade = int(0.3 * self.sampling_rate)
        for i, (loc_s, loc_e) in enumerate(word_locations):
            s = max(0, loc_s - fade)
            e = min(audio.shape[1] - 1, loc_e + fade)
            intonations[i] = torch.sqrt(torch.mean(audio[0][s:e] ** 2))
        mean = torch.mean(intonations)
        if mean < 1e-8:
            mean = torch.tensor(1.0)
        return intonations / mean

    # ── Timing ──────────────────────────────────────────────────────────────
    def getWordLocationsFromRecordInSeconds(self, word_locations: list, mapped_indices: list):
        start_list, end_list = [], []
        for idx in mapped_indices:
            loc = word_locations[idx] if 0 <= idx < len(word_locations) else (0, 0)
            start_list.append(loc[0] / self.sampling_rate)
            end_list.append(loc[1]   / self.sampling_rate)
        return (
            " ".join(str(t) for t in start_list),
            " ".join(str(t) for t in end_list),
        )

    # ── Preprocessing ───────────────────────────────────────────────────────
    def preprocessAudio(self, audio: torch.Tensor) -> torch.Tensor:
        """Remove DC offset and peak-normalise.  Guards against near-silence."""
        audio = audio - torch.mean(audio)
        peak  = torch.max(torch.abs(audio))
        if peak < 1e-4:
            peak = torch.tensor(1e-4)
        return audio / peak

    # ── Utils ───────────────────────────────────────────────────────────────
    def removePunctuation(self, word: str) -> str:
        return "".join(ch for ch in word if ch not in punctuation)