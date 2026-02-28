import models
import soundfile as sf
import json
import AIModels
import utilsFileIO
import os
import base64
import asyncio

sampling_rate = 16000

# ─────────────────────────────────────────────────────────────────────────────
# Voice map: language code → Microsoft Edge TTS neural voice name.
# These are all Indian-accent voices hosted by Microsoft (free, no API key).
# Swap female ↔ male by changing the voice name:
#   Hindi   female: hi-IN-SwaraNeural   male: hi-IN-MadhurNeural
#   Marathi female: mr-IN-AarohiNeural  male: mr-IN-ManoharNeural
# ─────────────────────────────────────────────────────────────────────────────
EDGE_TTS_VOICES = {
    'hi': 'hi-IN-SwaraNeural',    # Hindi  — Indian female neural voice
    'mr': 'mr-IN-AarohiNeural',   # Marathi — Indian female neural voice
}

# ─────────────────────────────────────────────────────────────────────────────
# English TTS — lazy-loaded Silero (local, no internet needed)
# ─────────────────────────────────────────────────────────────────────────────
_model_TTS_en = None

def _get_english_tts():
    global _model_TTS_en
    if _model_TTS_en is None:
        _model_TTS_en = AIModels.NeuralTTS(models.getTTSModel('en'), sampling_rate)
    return _model_TTS_en


# ─────────────────────────────────────────────────────────────────────────────
# Edge TTS helper (async → sync wrapper)
# ─────────────────────────────────────────────────────────────────────────────
async def _edge_tts_synthesise(text: str, voice: str, mp3_path: str):
    """Call edge-tts and save output as MP3."""
    try:
        import edge_tts
    except ImportError:
        raise RuntimeError(
            "edge-tts is not installed. Run: pip install edge-tts"
        )
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(mp3_path)


def _edge_tts_to_wav(text: str, voice: str, wav_path: str):
    """
    Synthesise text with the given Edge TTS voice and write a 16 kHz mono WAV
    to wav_path.  Works in both plain scripts and environments that already
    have a running event loop (e.g. Jupyter / some web servers).
    """
    mp3_path = wav_path.replace('.wav', '_tmp.mp3')

    # Run the async synthesis
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Already inside a running loop (e.g. Jupyter): use nest_asyncio
            import nest_asyncio
            nest_asyncio.apply()
        loop.run_until_complete(_edge_tts_synthesise(text, voice, mp3_path))
    except RuntimeError:
        # No event loop at all — create a fresh one
        asyncio.run(_edge_tts_synthesise(text, voice, mp3_path))

    # Convert MP3 → 16 kHz mono WAV using pydub
    try:
        from pydub import AudioSegment
    except ImportError:
        raise RuntimeError("pydub is not installed. Run: pip install pydub")

    audio_segment = AudioSegment.from_mp3(mp3_path)
    audio_segment = audio_segment.set_frame_rate(16000).set_channels(1)
    audio_segment.export(wav_path, format='wav')
    os.remove(mp3_path)


# ─────────────────────────────────────────────────────────────────────────────
# Main audio-generation function
# ─────────────────────────────────────────────────────────────────────────────
def _get_audio_bytes_for_language(text_string: str, language: str) -> bytes:
    """
    Returns raw WAV bytes for the given text and language.

    Language routing:
      'en'        → Silero TTS  (local, no internet)
      'hi', 'mr'  → Microsoft Edge TTS with Indian neural voices (internet needed)
    """
    random_file_name = utilsFileIO.generateRandomString(20) + '.wav'

    if language in EDGE_TTS_VOICES:
        voice = EDGE_TTS_VOICES[language]
        print(f"[lambdaTTS] Using Edge TTS voice: {voice}")
        _edge_tts_to_wav(text_string, voice, random_file_name)

    else:
        # English (default): Silero TTS
        print(f"[lambdaTTS] Using Silero TTS for language: {language}")
        linear_factor = 0.2
        audio = _get_english_tts().getAudioFromSentence(text_string).detach().numpy() * linear_factor
        sf.write('./' + random_file_name, audio, sampling_rate)

    with open(random_file_name, 'rb') as f:
        audio_bytes = f.read()

    os.remove(random_file_name)
    return audio_bytes


# ─────────────────────────────────────────────────────────────────────────────
# Lambda / Flask handler
# ─────────────────────────────────────────────────────────────────────────────
def lambda_handler(event, context):

    body = json.loads(event['body'])
    text_string = body['value']
    language = body.get('language', 'en')

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
            }
        )
    }