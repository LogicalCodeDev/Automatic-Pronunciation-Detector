import ModelInterfaces
import torch
import numpy as np
import epitran
import eng_to_ipa


def get_phonem_converter(language: str):
    if language == 'de':
        phonem_converter = EpitranPhonemConverter(
            epitran.Epitran('deu-Latn'))
    elif language == 'en':
        phonem_converter = EngPhonemConverter()
    elif language == 'hi':
        phonem_converter = HindiIPA()
    elif language == 'mr':
        phonem_converter = MarathiIPA()
    else:
        raise ValueError('Language not implemented')

    return phonem_converter

class EpitranPhonemConverter(ModelInterfaces.ITextToPhonemModel):
    word_locations_in_samples = None
    audio_transcript = None

    def __init__(self, epitran_model) -> None:
        super().__init__()
        self.epitran_model = epitran_model

    def convertToPhonem(self, sentence: str) -> str:
        phonem_representation = self.epitran_model.transliterate(sentence)
        return phonem_representation


class HindiIPA(ModelInterfaces.ITextToPhonemModel):
    """
    Converts Hindi Devanagari text to IPA phonemes via Epitran.
    Inherits ITextToPhonemModel so it works everywhere EngPhonemConverter does.
    Also applies schwa deletion — Epitran sometimes adds a trailing 'ə' that
    is silent in natural spoken Hindi (e.g. नमस्ते → nʌmʌsteː not nʌmʌsteːə).
    """

    def __init__(self):
        super().__init__()
        self.epitran_model = epitran.Epitran('hin-Deva')

    def convertToPhonem(self, text: str) -> str:
        if not text or text == '-':
            return text
        ipa = self.epitran_model.transliterate(text)
        ipa = self._fix_schwa_deletion(ipa)
        return ipa

    def _fix_schwa_deletion(self, ipa: str) -> str:
        """Remove word-final schwa (ə) that Epitran adds but Hindi speakers drop."""
        import re
        ipa = re.sub(r'ə(?=\s|$)', '', ipa)
        return ipa

class MarathiIPA(ModelInterfaces.ITextToPhonemModel):
    """
    Converts Marathi Devanagari text to IPA phonemes via Epitran.
    Marathi shares the Devanagari script with Hindi but has distinct phonology.
    Epitran code: 'mar-Deva'.
    Like Hindi, Marathi has schwa deletion at word-final positions, so we
    apply the same post-processing fix.
    """

    def __init__(self):
        super().__init__()
        self.epitran_model = epitran.Epitran('mar-Deva')

    def convertToPhonem(self, text: str) -> str:
        if not text or text == '-':
            return text
        ipa = self.epitran_model.transliterate(text)
        ipa = self._fix_schwa_deletion(ipa)
        return ipa

    def _fix_schwa_deletion(self, ipa: str) -> str:
        """Remove word-final schwa (ə) that Epitran adds but Marathi speakers drop."""
        import re
        ipa = re.sub(r'ə(?=\s|$)', '', ipa)
        return ipa

class EngPhonemConverter(ModelInterfaces.ITextToPhonemModel):

    def __init__(self,) -> None:
        super().__init__()

    def convertToPhonem(self, sentence: str) -> str:
        phonem_representation = eng_to_ipa.convert(sentence)
        phonem_representation = phonem_representation.replace('*','')
        return phonem_representation