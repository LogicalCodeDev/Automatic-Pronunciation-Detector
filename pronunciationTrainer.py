import torch
import numpy as np
import models as mo
import WordMetrics
import WordMatching as wm
import epitran
import ModelInterfaces as mi
import AIModels
import RuleBasedModels
from string import punctuation
import time
import difflib

def getTrainer(language: str):

    asr_model = mo.getASRModel(language,use_whisper=True)
    
    # if language == 'de':
    #     phonem_converter = RuleBasedModels.EpitranPhonemConverter(
    #         epitran.Epitran('deu-Latn'))
    if language == 'en':
        phonem_converter = RuleBasedModels.EngPhonemConverter()
    elif language == 'hi':
        phonem_converter = RuleBasedModels.HindiIPA()
    elif language == 'mr':
        phonem_converter = RuleBasedModels.MarathiIPA()
    else:
        raise ValueError('Language not implemented')

    trainer = PronunciationTrainer(
        asr_model, phonem_converter)

    return trainer


class PronunciationTrainer:
    current_transcript: str
    current_ipa: str

    current_recorded_audio: torch.Tensor
    current_recorded_transcript: str
    current_recorded_word_locations: list
    current_recorded_intonations: torch.tensor
    current_words_pronunciation_accuracy = []
    categories_thresholds = np.array([80, 60, 59])

    sampling_rate = 16000

    def __init__(self, asr_model: mi.IASRModel, word_to_ipa_coverter: mi.ITextToPhonemModel) -> None:
        self.asr_model = asr_model
        self.ipa_converter = word_to_ipa_coverter

    def getTranscriptAndWordsLocations(self, audio_length_in_samples: int):

        audio_transcript = self.asr_model.getTranscript()
        word_locations_in_samples = self.asr_model.getWordLocations()

        fade_duration_in_samples = 0.05 * self.sampling_rate
        word_locations_in_samples = [
            (int(np.maximum(0, word['start_ts'] - fade_duration_in_samples)),
             int(np.minimum(audio_length_in_samples - 1, word['end_ts'] + fade_duration_in_samples)))
            for word in word_locations_in_samples
        ]

        return audio_transcript, word_locations_in_samples

    def getWordsRelativeIntonation(self, Audio: torch.tensor, word_locations: list):
        intonations = torch.zeros((len(word_locations), 1))
        intonation_fade_samples = 0.3 * self.sampling_rate
        print(intonations.shape)
        for word in range(len(word_locations)):
            intonation_start = int(np.maximum(
                0, word_locations[word][0] - intonation_fade_samples))
            intonation_end = int(np.minimum(
                Audio.shape[1] - 1, word_locations[word][1] + intonation_fade_samples))
            intonations[word] = torch.sqrt(torch.mean(
                Audio[0][intonation_start:intonation_end] ** 2))

        # normalize, but guard divide-by-zero
        mean_int = torch.mean(intonations) if torch.mean(intonations) != 0 else 1.0
        intonations = intonations / mean_int
        return intonations


    def processAudioForGivenText(self, recordedAudio: torch.Tensor = None, real_text=None):

        start = time.time()
        recording_transcript, recording_ipa, word_locations = self.getAudioTranscript(recordedAudio)
        print('Time for NN to transcript audio: ', str(time.time() - start))

        start = time.time()
        real_and_transcribed_words, real_and_transcribed_words_ipa, mapped_words_indices = self.matchSampleAndRecordedWords(
            real_text, recording_transcript)
        print('Time for matching transcripts: ', str(time.time() - start))

        start_time, end_time = self.getWordLocationsFromRecordInSeconds(word_locations, mapped_words_indices)

        # CHANGE: call the in-class getPronunciationAccuracy (works on IPA pairs)
        pronunciation_accuracy, current_words_pronunciation_accuracy = self.getPronunciationAccuracy(
            real_and_transcribed_words_ipa)  # _ipa

        pronunciation_categories = self.getWordsPronunciationCategory(current_words_pronunciation_accuracy)

        result = {'recording_transcript': recording_transcript,
                  'real_and_transcribed_words': real_and_transcribed_words,
                  'recording_ipa': recording_ipa, 'start_time': start_time, 'end_time': end_time,
                  'real_and_transcribed_words_ipa': real_and_transcribed_words_ipa, 'pronunciation_accuracy': pronunciation_accuracy,
                  'pronunciation_categories': pronunciation_categories}

        return result

    def getAudioTranscript(self, recordedAudio: torch.Tensor = None):
        current_recorded_audio = recordedAudio

        current_recorded_audio = self.preprocessAudio(current_recorded_audio)

        self.asr_model.processAudio(current_recorded_audio)

        current_recorded_transcript, current_recorded_word_locations = self.getTranscriptAndWordsLocations(
            current_recorded_audio.shape[1])
        current_recorded_ipa = self.ipa_converter.convertToPhonem(current_recorded_transcript)

        return current_recorded_transcript, current_recorded_ipa, current_recorded_word_locations

    def getWordLocationsFromRecordInSeconds(self, word_locations, mapped_words_indices) -> list:
        start_time = []
        end_time = []
        for word_idx in range(len(mapped_words_indices)):
            start_time.append(float(word_locations[mapped_words_indices[word_idx]][0]) / self.sampling_rate)
            end_time.append(float(word_locations[mapped_words_indices[word_idx]][1]) / self.sampling_rate)
        return ' '.join([str(time) for time in start_time]), ' '.join([str(time) for time in end_time])

    # CHANGE: fuzzy_map_words is a METHOD and takes self
    def fuzzy_map_words(self, estimated_words, real_words, cutoff=0.35):
        """
        Return a list 'mapped' of same length as real_words where each element is
        the best match from estimated_words or '-' if no good match.
        """
        mapped = []
        for real in real_words:
            best = None
            best_score = 0.0
            for est in estimated_words:
                score = difflib.SequenceMatcher(None, real.lower(), est.lower()).ratio()
                if score > best_score:
                    best = est
                    best_score = score
            if best_score >= cutoff:
                mapped.append(best)
            else:
                mapped.append('-')
        return mapped

    def matchSampleAndRecordedWords(self, real_text, recorded_transcript):
        words_estimated = recorded_transcript.split()

        if real_text is None:
            words_real = self.current_transcript[0].split()
        else:
            words_real = real_text.split()

        # Try original mapping method first
        try:
            mapped_words, mapped_words_indices = wm.get_best_mapped_words(words_estimated, words_real)
        except Exception as ex:
            print("[WARN] wm.get_best_mapped_words failed:", repr(ex))
            mapped_words = ['-'] * len(words_real)
            mapped_words_indices = [0] * len(words_real)

        # If mapping produced many gaps or is clearly broken, use fuzzy fallback
        gap_fraction = sum(1 for w in mapped_words if w == '-') / max(1, len(mapped_words))
        if gap_fraction > 0.4 or len(mapped_words) < len(words_real):
            print("[WARN] mapping produced many gaps; using fuzzy fallback")
            mapped_words = self.fuzzy_map_words(words_estimated, words_real, cutoff=0.35)
            # Build mapped indices by locating first matching index in words_estimated, preserving order
            mapped_words_indices = []
            last_found = 0
            for mw in mapped_words:
                if mw == '-' or len(words_estimated) == 0:
                    # fallback to nearest index 0
                    mapped_words_indices.append(0)
                    continue
                found_idx = -1
                # search from last_found to preserve monotonicity
                for i in range(last_found, len(words_estimated)):
                    if words_estimated[i].lower() == mw.lower():
                        found_idx = i
                        break
                # if not found, search full list
                if found_idx == -1:
                    for i in range(0, last_found):
                        if words_estimated[i].lower() == mw.lower():
                            found_idx = i
                            break
                if found_idx == -1:
                    found_idx = 0
                mapped_words_indices.append(found_idx)
                last_found = max(0, found_idx)

        # Build return pairs (real, mapped)
        real_and_transcribed_words = []
        real_and_transcribed_words_ipa = []
        for word_idx in range(len(words_real)):
            mapped_word = mapped_words[word_idx] if word_idx < len(mapped_words) else '-'
            # convert to IPA using converter (safe convert '-' -> '-')
            real_ipa = self.ipa_converter.convertToPhonem(words_real[word_idx])
            mapped_ipa = self.ipa_converter.convertToPhonem(mapped_word) if mapped_word != '-' else '-'
            real_and_transcribed_words.append((words_real[word_idx], mapped_word))
            real_and_transcribed_words_ipa.append((real_ipa, mapped_ipa))

        return real_and_transcribed_words, real_and_transcribed_words_ipa, mapped_words_indices

    # CHANGE: getPronunciationAccuracy is INSIDE the class now (was previously defined outside)
    def getPronunciationAccuracy(self, real_and_transcribed_words_ipa):
        """
        Compute pronunciation accuracy using IPA pairs (phoneme-level).
        Returns (overall_percentage_rounded, per_word_percentages_list).
        Robust to empty strings, maps lengths mismatch, clamps to [0,100].
        """
        total_mismatches = 0.0
        number_of_phonemes = 0
        current_words_pronunciation_accuracy = []

        for pair in real_and_transcribed_words_ipa:
            # Expect pair = (real_ipa, transcribed_ipa)
            real_ipa = self.removePunctuation(pair[0]).lower() if pair[0] is not None else ""
            trans_ipa = self.removePunctuation(pair[1]).lower() if pair[1] is not None else ""

            # If the reference (real_ipa) is empty, mark 0% (can't evaluate)
            if len(real_ipa) == 0:
                current_words_pronunciation_accuracy.append(0.0)
                continue

            # use your edit distance implementation on phoneme strings
            try:
                number_of_word_mismatches = WordMetrics.edit_distance_python(real_ipa, trans_ipa)
            except Exception as ex:
                print("[WARN] edit_distance failed for pair:", real_ipa, trans_ipa, repr(ex))
                number_of_word_mismatches = max(len(real_ipa), len(trans_ipa))

            # per-word phoneme count
            number_of_phonemes_in_word = len(real_ipa)
            number_of_phonemes += number_of_phonemes_in_word
            total_mismatches += number_of_word_mismatches

            # per-word accuracy: clamp to [0,100]
            per_word_acc = (number_of_phonemes_in_word - number_of_word_mismatches) / number_of_phonemes_in_word * 100.0
            per_word_acc = max(0.0, min(100.0, per_word_acc))
            current_words_pronunciation_accuracy.append(per_word_acc)

        # overall accuracy: guard division-by-zero and clamp
        if number_of_phonemes == 0:
            percentage_of_correct_pronunciations = 0.0
        else:
            percentage_of_correct_pronunciations = (number_of_phonemes - total_mismatches) / number_of_phonemes * 100.0
            percentage_of_correct_pronunciations = max(0.0, min(100.0, percentage_of_correct_pronunciations))

        # round the reported overall accuracy (keep per-word unrounded for downstream uses)
        return float(np.round(percentage_of_correct_pronunciations)), current_words_pronunciation_accuracy

    def removePunctuation(self, word: str) -> str:
        return ''.join([char for char in word if char not in punctuation])

    def getWordsPronunciationCategory(self, accuracies) -> list:
        categories = []

        for accuracy in accuracies:
            categories.append(self.getPronunciationCategoryFromAccuracy(accuracy))

        return categories

    def getPronunciationCategoryFromAccuracy(self, accuracy) -> int:
        return np.argmin(abs(self.categories_thresholds - accuracy))

    def preprocessAudio(self, audio: torch.tensor) -> torch.tensor:
        # remove DC and normalize peak with floor to avoid amplifying near-silence
        audio = audio - torch.mean(audio)
        peak = torch.max(torch.abs(audio))
        # avoid dividing by zero or very small numbers
        if peak < 1e-4:
            peak = 1e-4
        audio = audio / peak
        return audio