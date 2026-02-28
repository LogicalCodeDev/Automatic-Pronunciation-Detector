import torch
import json
import os
import WordMatching as wm
import utilsFileIO
import pronunciationTrainer
import base64
import time
import audioread
import numpy as np
from torchaudio.transforms import Resample
import io
import tempfile
import tempfile
import traceback

trainer_SST_lambda = {}
# trainer_SST_lambda['de'] = pronunciationTrainer.getTrainer("de")
trainer_SST_lambda['en'] = pronunciationTrainer.getTrainer("en")
trainer_SST_lambda['hi'] = pronunciationTrainer.getTrainer("hi")
trainer_SST_lambda['mr'] = pronunciationTrainer.getTrainer("mr")


transform = Resample(orig_freq=48000, new_freq=16000)


def lambda_handler(event, context):
    """
    Expects: event['body'] to be a JSON string with keys:
      - title: string (the transcript / reference text)
      - base64Audio: either a full data URI "data:audio/ogg;base64,AAAA..." or the base64 payload only
      - language: 'en' 

    Returns:
      - On success: JSON string (json.dumps) of the same structure your pipeline expects.
      - On error: JSON string of form {"error": "<message>"} 
    """

    try:
        # Parse incoming body
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body') or {}

        real_text = body.get('title', '') or ''
        b64_input = body.get('base64Audio', '') or ''
        language = body.get('language', 'en') or 'en'

        # print("Pratham: ",real_text, b64_input, language)

        print("[lambda_handler] Received request - title:", real_text,
              " language:", language, " base64 len:", len(b64_input))

        # If no reference text, return empty
        if len(real_text) == 0:
            print("[lambda_handler] Empty title provided: returning empty body.")
            return json.dumps('')

        # Robust Base64 handling
        if not isinstance(b64_input, str) or len(b64_input.strip()) == 0:
            err_msg = "No base64Audio provided"
            print("[lambda_handler] ERROR:", err_msg)
            return json.dumps({'error': err_msg})

        # If it's a data URI, strip the prefix and detect format
        file_extension = ".ogg"  # DEFAULT TO OGG since frontend uses OGG
        if b64_input.startswith('data:'):
            comma_idx = b64_input.find(',')
            if comma_idx == -1:
                err_msg = "Malformed data URI for audio"
                print("[lambda_handler] ERROR:", err_msg)
                return json.dumps({'error': err_msg})
            
            # Extract MIME type to determine file extension
            mime_type = b64_input[5:comma_idx]
            if 'ogg' in mime_type:
                file_extension = ".ogg"
            elif 'webm' in mime_type:
                file_extension = ".webm"
            elif 'mp3' in mime_type:
                file_extension = ".mp3"
            elif 'wav' in mime_type:
                file_extension = ".wav"
                
            b64_payload = b64_input[comma_idx + 1:]
        else:
            b64_payload = b64_input

        print(f"[lambda_handler] Using audio format: {file_extension}")

        # sanity check
        if len(b64_payload) < 20:
            err_msg = "Base64 audio payload too short"
            print("[lambda_handler] ERROR:", err_msg)
            return json.dumps({'error': err_msg})

        # decode base64
        try:
            file_bytes = base64.b64decode(b64_payload.encode('utf-8'))
            # print("Pratham:",file_bytes)
            print(f"[lambda_handler] Decoded {len(file_bytes)} bytes of audio data")
        except Exception as ex:
            print("[lambda_handler] ERROR decoding base64:", repr(ex))
            return json.dumps({'error': 'Failed to decode base64 audio: ' + str(ex)})

        # write to temporary file with correct extension
        tmp = tempfile.NamedTemporaryFile(suffix=file_extension, delete=False)
        tmp_name = tmp.name
        try:
            tmp.write(file_bytes)
            tmp.flush()
            tmp.close()

            # Load the audio with robust loader
            try:
                signal, fs = audioread_load_with_fallback(tmp_name)
                print(f"[lambda_handler] Audio loaded - shape: {signal.shape if hasattr(signal, 'shape') else len(signal)}, sample rate: {fs}")
            except Exception as ex:
                print("[lambda_handler] ERROR loading audio:", repr(ex))
                traceback.print_exc()
                return json.dumps({'error': 'Failed to load audio file. Please ensure the audio recording is valid and try again.'})
                
        finally:
            try:
                os.remove(tmp_name)
            except Exception as ex_rm:
                print("[lambda_handler] Warning: failed to remove temp file:", tmp_name, repr(ex_rm))

        # Convert to tensor and ensure proper shape
        try:
            if isinstance(signal, np.ndarray):
                # If multi-channel, convert to mono by averaging
                if signal.ndim > 1:
                    signal = np.mean(signal, axis=1)
                
                # Apply resampling transform if needed
                signal_tensor = transform(torch.FloatTensor(signal)).unsqueeze(0)  # shape (1, samples)
            else:
                signal_tensor = transform(torch.FloatTensor(signal)).unsqueeze(0)
                
            print(f"[lambda_handler] Audio tensor shape: {signal_tensor.shape}")
            
        except Exception as ex:
            print("[lambda_handler] ERROR converting to tensor:", repr(ex))
            traceback.print_exc()
            return json.dumps({'error': 'Failed to process audio tensor: ' + str(ex)})

        # Validate audio
        try:
            validate_audio(signal_tensor, fs)
        except Exception as ex:
            print("[lambda_handler] ERROR audio validation failed:", repr(ex))
            return json.dumps({'error': f'Audio validation failed: {str(ex)}'})

        # Run pronunciation pipeline
        try:
            if language not in trainer_SST_lambda:
                err_msg = f"Language '{language}' not supported by trainer."
                print("[lambda_handler] ERROR:", err_msg)
                return json.dumps({'error': err_msg})

            start_proc = time.time()
            result = trainer_SST_lambda[language].processAudioForGivenText(signal_tensor, real_text)
            print("Pratham: ",result)
            print("[lambda_handler] Processing time (sec):", time.time() - start_proc)
        except Exception as ex:
            print("[lambda_handler] ERROR processing audio for text:", repr(ex))
            traceback.print_exc()
            return json.dumps({'error': 'Processing error: ' + str(ex)})

        # Post-process results to build response
        try:
            real_transcripts_ipa = ' '.join([word[0] for word in result['real_and_transcribed_words_ipa']])
            matched_transcripts_ipa = ' '.join([word[1] for word in result['real_and_transcribed_words_ipa']])

            real_transcripts = ' '.join([word[0] for word in result['real_and_transcribed_words']])
            matched_transcripts = ' '.join([word[1] for word in result['real_and_transcribed_words']])

            words_real = real_transcripts.lower().split()
            mapped_words = matched_transcripts.split()

            is_letter_correct_all_words = ''
            for idx, word_real in enumerate(words_real):
                try:
                    if idx < len(mapped_words):
                        mapped_letters, mapped_letters_indices = wm.get_best_mapped_words(mapped_words[idx], word_real)
                        is_letter_correct = wm.getWhichLettersWereTranscribedCorrectly(word_real, mapped_letters)
                        is_letter_correct_all_words += ''.join([str(int(is_correct)) for is_correct in is_letter_correct]) + ' '
                    else:
                        is_letter_correct_all_words += '0' * len(word_real) + ' '
                except Exception as ex_wm:
                    print(f"[lambda_handler] Warning mapping letters for word index {idx}: {repr(ex_wm)}")
                    is_letter_correct_all_words += '0' * len(word_real) + ' '

            pair_accuracy_category = ' '.join([str(category) for category in result.get('pronunciation_categories', [])])

            res = {
                'real_transcript': result.get('recording_transcript', ''),
                'ipa_transcript': result.get('recording_ipa', ''),
                'pronunciation_accuracy': str(int(result.get('pronunciation_accuracy', 0))),
                'real_transcripts': real_transcripts,
                'matched_transcripts': matched_transcripts,
                'real_transcripts_ipa': real_transcripts_ipa,
                'matched_transcripts_ipa': matched_transcripts_ipa,
                'pair_accuracy_category': pair_accuracy_category,
                'start_time': result.get('start_time', ''),
                'end_time': result.get('end_time', ''),
                'is_letter_correct_all_words': is_letter_correct_all_words.strip()
            }

            print(res)

            print(f"[lambda_handler] Success - accuracy: {res['pronunciation_accuracy']}%")
            return json.dumps(res)
            
        except Exception as ex:
            print("[lambda_handler] ERROR building response:", repr(ex))
            traceback.print_exc()
            return json.dumps({'error': 'Failed to build response: ' + str(ex)})

    except Exception as e:
        print("[lambda_handler] Unhandled exception:", repr(e))
        traceback.print_exc()
        return json.dumps({'error': 'Unhandled error: ' + str(e)})
    


def audioread_load(path, offset=0.0, duration=None, dtype=np.float32):
    """Load an audio buffer using audioread.

    This loads one block at a time, and then concatenates the results.
    """

    y = []
    with audioread.audio_open(path) as input_file:
        sr_native = input_file.samplerate
        n_channels = input_file.channels

        s_start = int(np.round(sr_native * offset)) * n_channels

        if duration is None:
            s_end = np.inf
        else:
            s_end = s_start + \
                (int(np.round(sr_native * duration)) * n_channels)

        n = 0

        for frame in input_file:
            frame = buf_to_float(frame, dtype=dtype)
            n_prev = n
            n = n + len(frame)

            if n < s_start:
                # offset is after the current frame
                # keep reading
                continue

            if s_end < n_prev:
                # we're off the end.  stop reading
                break

            if s_end < n:
                # the end is in this frame.  crop.
                frame = frame[: s_end - n_prev]

            if n_prev <= s_start <= n:
                # beginning is in this frame
                frame = frame[(s_start - n_prev):]

            # tack on the current frame
            y.append(frame)

    if y:
        y = np.concatenate(y)
        if n_channels > 1:
            y = y.reshape((-1, n_channels)).T
    else:
        y = np.empty(0, dtype=dtype)

    return y, sr_native

# From Librosa



import os
import traceback
import numpy as np

# Optional imports - may not exist in your env; we guard them
try:
    import soundfile as sf
except Exception:
    sf = None

try:
    import librosa
except Exception:
    librosa = None

import subprocess

def _read_magic_bytes(path, n=16):
    try:
        with open(path, 'rb') as f:
            return f.read(n)
    except Exception:
        return b''


def audioread_load_with_fallback(path, offset=0.0, duration=None, dtype=np.float32):
    """
    Robust audio loading with multiple fallbacks - NO FFMPEG REQUIRED
    Returns (audio_array, sample_rate)
    """
    print(f"[audioread_load_with_fallback] Attempting to load: {path}")
    
    # Try soundfile first (best for WAV files)
    try:
        import soundfile as sf
        print("[audioread_load_with_fallback] Trying soundfile...")
        audio, sr = sf.read(path)
        # Convert to mono if multi-channel
        if audio.ndim > 1:
            audio = np.mean(audio, axis=1)
        print(f"[audioread_load_with_fallback] Soundfile success - SR: {sr}, shape: {audio.shape}")
        return audio, sr
    except Exception as e:
        print(f"[audioread_load_with_fallback] Soundfile failed: {e}")

    # Try librosa with its built-in loaders
    try:
        import librosa
        print("[audioread_load_with_fallback] Trying librosa...")
        # Force using audioread backend for librosa
        audio, sr = librosa.load(path, sr=None, mono=True)
        print(f"[audioread_load_with_fallback] Librosa success - SR: {sr}, shape: {audio.shape}")
        return audio, sr
    except Exception as e:
        print(f"[audioread_load_with_fallback] Librosa failed: {e}")

    # Try pydub with simple WAV handling (no FFmpeg)
    try:
        from pydub import AudioSegment
        print("[audioread_load_with_fallback] Trying pydub without FFmpeg...")
        
        # Check file extension and use appropriate method
        if path.lower().endswith('.wav'):
            # For WAV files, use raw file reading
            audio_segment = AudioSegment.from_wav(path)
        elif path.lower().endswith('.ogg'):
            # For OGG files, try using the raw data
            with open(path, 'rb') as f:
                data = f.read()
            audio_segment = AudioSegment.from_file(path, format="ogg")
        else:
            # Try auto-detection
            audio_segment = AudioSegment.from_file(path)
        
        # Convert to mono if needed
        if audio_segment.channels > 1:
            audio_segment = audio_segment.set_channels(1)
        
        # Convert to numpy array
        samples = np.array(audio_segment.get_array_of_samples())
        sr = audio_segment.frame_rate
        
        # Normalize to float32
        if audio_segment.sample_width == 2:  # 16-bit
            audio = samples.astype(np.float32) / 32768.0
        elif audio_segment.sample_width == 4:  # 32-bit
            audio = samples.astype(np.float32) / 2147483648.0
        else:  # 8-bit or other
            audio = samples.astype(np.float32) / np.iinfo(samples.dtype).max
        
        print(f"[audioread_load_with_fallback] Pydub success - SR: {sr}, shape: {audio.shape}")
        return audio, sr
    except Exception as e:
        print(f"[audioread_load_with_fallback] Pydub failed: {e}")

    # Try the original audioread as last resort
    try:
        print("[audioread_load_with_fallback] Trying original audioread...")
        audio, sr = audioread_load(path)
        print(f"[audioread_load_with_fallback] Audioread success - SR: {sr}, shape: {audio.shape}")
        return audio, sr
    except Exception as e:
        print(f"[audioread_load_with_fallback] Audioread failed: {e}")

    # Final attempt: manual WAV file reading
    try:
        print("[audioread_load_with_fallback] Trying manual WAV reading...")
        audio, sr = read_wav_manually(path)
        print(f"[audioread_load_with_fallback] Manual WAV reading success - SR: {sr}, shape: {audio.shape}")
        return audio, sr
    except Exception as e:
        print(f"[audioread_load_with_fallback] Manual WAV reading failed: {e}")

    raise RuntimeError("All audio loading methods failed. Please check if the audio file is valid and not corrupted.")

def read_wav_manually(path):
    """
    Manual WAV file reader - works without any external dependencies
    """
    try:
        import wave
        import struct
        
        with wave.open(path, 'rb') as wav_file:
            # Get basic info
            n_channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            frame_rate = wav_file.getframerate()
            n_frames = wav_file.getnframes()
            
            # Read all frames
            frames = wav_file.readframes(n_frames)
            
            # Convert to numpy array based on sample width
            if sample_width == 1:  # 8-bit
                dtype = np.uint8
                audio_data = np.frombuffer(frames, dtype=dtype)
                audio = (audio_data.astype(np.float32) - 128) / 128.0
            elif sample_width == 2:  # 16-bit
                dtype = np.int16
                audio_data = np.frombuffer(frames, dtype=dtype)
                audio = audio_data.astype(np.float32) / 32768.0
            elif sample_width == 4:  # 32-bit
                dtype = np.int32
                audio_data = np.frombuffer(frames, dtype=dtype)
                audio = audio_data.astype(np.float32) / 2147483648.0
            else:
                raise ValueError(f"Unsupported sample width: {sample_width}")
            
            # Handle multi-channel audio
            if n_channels > 1:
                audio = audio.reshape(-1, n_channels)
                audio = np.mean(audio, axis=1)  # Convert to mono
            
            return audio, frame_rate
            
    except Exception as e:
        raise RuntimeError(f"Manual WAV reading failed: {e}")


def buf_to_float(x, n_bytes=2, dtype=np.float32):
    """Convert an integer buffer to floating point values.
    This is primarily useful when loading integer-valued wav data
    into numpy arrays.

    Parameters
    ----------
    x : np.ndarray [dtype=int]
        The integer-valued data buffer

    n_bytes : int [1, 2, 4]
        The number of bytes per sample in ``x``

    dtype : numeric type
        The target output type (default: 32-bit float)

    Returns
    -------
    x_float : np.ndarray [dtype=float]
        The input data buffer cast to floating point
    """

    # Invert the scale of the data
    scale = 1.0 / float(1 << ((8 * n_bytes) - 1))

    # Construct the format string
    fmt = "<i{:d}".format(n_bytes)

    # Rescale and format the data buffer
    return scale * np.frombuffer(x, fmt).astype(dtype)




def validate_audio(audio_tensor, sr=16000):
    """Basic audio validation"""
    if audio_tensor.numel() == 0:
        raise ValueError("Empty audio tensor")
    
    duration = audio_tensor.shape[1] / sr
    if duration < 0.1:  # Minimum 100ms
        raise ValueError(f"Audio too short: {duration:.2f}s")
    
    if duration > 30.0:  # Maximum 30 seconds
        raise ValueError(f"Audio too long: {duration:.2f}s")
    
    # Check for silence
    rms = torch.sqrt(torch.mean(audio_tensor ** 2))
    if rms < 0.001:  # Too quiet
        raise ValueError(f"Audio too quiet: RMS={rms:.4f}")
    
    print(f"[validate_audio] Audio valid - duration: {duration:.2f}s, RMS: {rms:.4f}")
    return True