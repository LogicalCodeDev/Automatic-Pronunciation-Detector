import models
import soundfile as sf
import json
import AIModels
import utilsFileIO
import os
import base64

sampling_rate = 16000

# English TTS — lazy-loaded at first use
_model_TTS_en = None

def _get_english_tts():
    global _model_TTS_en
    if _model_TTS_en is None:
        _model_TTS_en = AIModels.NeuralTTS(models.getTTSModel('en'), sampling_rate)
    return _model_TTS_en


def _get_audio_bytes_for_language(text_string: str, language: str) -> bytes:
    """
    Returns raw WAV bytes for the given text and language.
    - English: uses Silero TTS (local, no internet needed)
    - Hindi:   uses gTTS (Google TTS, requires internet) because Silero has no Hindi model
    """
    random_file_name = utilsFileIO.generateRandomString(20) + '.wav'

    if language in ('hi', 'mr'):
        # --- Hindi: use gTTS ---
        try:
            from gtts import gTTS
            import io

            # Map internal language code to gTTS language code
            gtts_lang = 'mr' if language == 'mr' else 'hi'
            tts = gTTS(text=text_string, lang=gtts_lang, slow=False)

            # gTTS produces MP3; convert to WAV via pydub
            mp3_fp = io.BytesIO()
            tts.write_to_fp(mp3_fp)
            mp3_fp.seek(0)

            from pydub import AudioSegment
            audio_segment = AudioSegment.from_mp3(mp3_fp)
            audio_segment = audio_segment.set_frame_rate(16000).set_channels(1)
            audio_segment.export(random_file_name, format='wav')

        except ImportError:
            raise RuntimeError(
                "gTTS and/or pydub are not installed. "
                "Run: pip install gTTS pydub"
            )
    else:
        # --- English (default): use Silero TTS ---
        linear_factor = 0.2
        audio = _get_english_tts().getAudioFromSentence(text_string).detach().numpy() * linear_factor
        sf.write('./' + random_file_name, audio, sampling_rate)

    with open(random_file_name, 'rb') as f:
        audio_bytes = f.read()

    os.remove(random_file_name)
    return audio_bytes


def lambda_handler(event, context):

    body = json.loads(event['body'])

    text_string = body['value']
    language = body.get('language', 'en')  # default to English if not provided

    print(f"[lambdaTTS] text='{text_string}', language='{language}'")

    audio_byte_array = _get_audio_bytes_for_language(text_string, language)

    return {
        'statusCode': 200,
        'headers': {
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
        },
        'body': json.dumps(
            {
                "wavBase64": str(base64.b64encode(audio_byte_array))[2:-1],
            },
        )
    }