import torch
import torch.nn as nn
import pickle
from ModelInterfaces import IASRModel
from AIModels import NeuralASR 

# def getASRModel(language: str,use_whisper:bool=True) -> IASRModel:

#     if use_whisper:
#         from whisper_wrapper import WhisperASRModel
#         return WhisperASRModel()
    
#     if language == 'de':

#         model, decoder, utils = torch.hub.load(repo_or_dir='snakers4/silero-models',
#                                                model='silero_stt',
#                                                language='de',
#                                                device=torch.device('cpu'))
#         model.eval()
#         return NeuralASR(model, decoder)

#     elif language == 'en':
#         model, decoder, utils = torch.hub.load(repo_or_dir='snakers4/silero-models',
#                                                model='silero_stt',
#                                                language='en',
#                                                device=torch.device('cpu'))
#         model.eval()
#         return NeuralASR(model, decoder)
#     elif language == 'fr':
#         model, decoder, utils = torch.hub.load(repo_or_dir='snakers4/silero-models',
#                                                model='silero_stt',
#                                                language='fr',
#                                                device=torch.device('cpu'))
#         model.eval()
#         return NeuralASR(model, decoder)
#     else:
#         raise ValueError('Language not implemented')


def getASRModel(language: str, use_whisper: bool = True) -> IASRModel:
    """
    Return an IASRModel. If use_whisper is True this will return the local
    Whisper wrapper configured to a robust model and forced language.
    """
    if use_whisper:
        # choose a model that balances quality and speed
        model_name = "openai/whisper-small"   # try "openai/whisper-medium" if you need better accuracy
        from whisper_wrapper import WhisperASRModel
        # pass device=-1 for CPU or device=0 for first GPU if available
        return WhisperASRModel(model_name=model_name, force_language=language, device=-1)

    if language == 'de':
        model, decoder, utils = torch.hub.load(repo_or_dir='snakers4/silero-models',
                                               model='silero_stt',
                                               language='de',
                                               device=torch.device('cpu'))
        model.eval()
        return NeuralASR(model, decoder)

    elif language == 'en':
        model, decoder, utils = torch.hub.load(repo_or_dir='snakers4/silero-models',
                                               model='silero_stt',
                                               language='en',
                                               device=torch.device('cpu'))
        model.eval()
        return NeuralASR(model, decoder)
    elif language == 'fr':
        model, decoder, utils = torch.hub.load(repo_or_dir='snakers4/silero-models',
                                               model='silero_stt',
                                               language='fr',
                                               device=torch.device('cpu'))
        model.eval()
        return NeuralASR(model, decoder)
    else:
        raise ValueError('Language not implemented')



def getTTSModel(language: str) -> nn.Module:

    if language == 'de':

        speaker = 'thorsten_v2'  # 16 kHz
        model, _ = torch.hub.load(repo_or_dir='snakers4/silero-models',
                                  model='silero_tts',
                                  language=language,
                                  speaker=speaker)

    elif language == 'en':
        print("English text to speech loaded!")
        speaker = 'lj_16khz'  # 16 kHz
        model = torch.hub.load(repo_or_dir='snakers4/silero-models',
                               model='silero_tts',
                               language=language,
                               speaker=speaker)
    else:
        raise ValueError('Language not implemented')

    return model


def getTranslationModel(language: str) -> nn.Module:
    from transformers import AutoTokenizer
    from transformers import AutoModelForSeq2SeqLM
    if language == 'de':
        model = AutoModelForSeq2SeqLM.from_pretrained(
            "Helsinki-NLP/opus-mt-de-en")
        tokenizer = AutoTokenizer.from_pretrained(
            "Helsinki-NLP/opus-mt-de-en")
        # Cache models to avoid Hugging face processing
        with open('translation_model_de.pickle', 'wb') as handle:
            pickle.dump(model, handle)
        with open('translation_tokenizer_de.pickle', 'wb') as handle:
            pickle.dump(tokenizer, handle)
    else:
        raise ValueError('Language not implemented')

    return model, tokenizer
