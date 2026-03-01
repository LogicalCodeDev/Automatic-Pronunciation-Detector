# import io
# import os
# os.environ["PYTHONUTF8"] = "1"  
# import pandas as _pd

# _orig_read_csv = _pd.read_csv
# _try_detector = None
# try:
#     from charset_normalizer import from_bytes
#     def _detect_encoding_bytes(b):
#         r = from_bytes(b).best()
#         return r.encoding if r else None
#     _try_detector = _detect_encoding_bytes
# except Exception:
#     _try_detector = None

# def _read_csv_force_utf8(*args, **kwargs):
#     # If caller explicitly provided encoding, respect it
#     if 'encoding' in kwargs or len(args) == 0:
#         return _orig_read_csv(*args, **kwargs)

#     encodings = ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252']
#     first = args[0]

#     # Detect file-like objects (has .read)
#     if hasattr(first, 'read') and callable(first.read):
#         # If file-like has .name and it's a real path, reopen it by path
#         name = getattr(first, 'name', None)
#         if isinstance(name, str) and os.path.exists(name):
#             for enc in encodings:
#                 try:
#                     return _orig_read_csv(name, encoding=enc, **kwargs)
#                 except UnicodeDecodeError:
#                     continue
#             # fallback
#             return _orig_read_csv(name, **kwargs)

#         # Otherwise read bytes/text and decode ourselves
#         try:
#             data = first.read()
#         except Exception:
#             # Can't read: fallback to trying pandas with encodings
#             for enc in encodings:
#                 try:
#                     return _orig_read_csv(*args, encoding=enc, **kwargs)
#                 except Exception:
#                     pass
#             return _orig_read_csv(*args, **kwargs)

#         if isinstance(data, bytes):
#             # try detector
#             if _try_detector:
#                 enc = _try_detector(data)
#                 if enc:
#                     try:
#                         return _orig_read_csv(io.StringIO(data.decode(enc)), **kwargs)
#                     except Exception:
#                         pass
#             for enc in encodings:
#                 try:
#                     return _orig_read_csv(io.StringIO(data.decode(enc)), **kwargs)
#                 except Exception:
#                     continue
#             raise UnicodeDecodeError("Could not decode file-like object with tried encodings")
#         else:
#             # already text
#             return _orig_read_csv(io.StringIO(data), **kwargs)

#     else:
#         # path-like: try encodings
#         last_err = None
#         for enc in encodings:
#             try:
#                 return _orig_read_csv(*args, encoding=enc, **kwargs)
#             except UnicodeDecodeError as e:
#                 last_err = e
#                 continue
#             except Exception:
#                 raise
#         if last_err:
#             raise last_err
#         return _orig_read_csv(*args, **kwargs)

# _pd.read_csv = _read_csv_force_utf8
# # ---------------------------------------------------------------------------

# # Standard Flask imports
# from flask import Flask, render_template, request, jsonify, Response
# from flask_cors import CORS
# import json
# import importlib
# import webbrowser
# import base64

# app = Flask(__name__)
# cors = CORS(app)
# app.config['CORS_HEADERS'] = '*'

# # lazy-loaded modules (avoid heavy imports at startup)
# _lambdaTTS = None
# _lambdaSpeechToScore = None
# _lambdaGetSample = None

# def ensure_lambda_modules():
#     global _lambdaTTS, _lambdaSpeechToScore, _lambdaGetSample
#     if _lambdaTTS is None or _lambdaSpeechToScore is None or _lambdaGetSample is None:
#         # import only when needed (prevents startup failures if panphon/epitran break)
#         _lambdaTTS = importlib.import_module("lambdaTTS")
#         _lambdaSpeechToScore = importlib.import_module("lambdaSpeechToScore")
#         _lambdaGetSample = importlib.import_module("lambdaGetSample")

# rootPath = ''

# @app.route(rootPath+'/')
# def main():
#     return render_template('main.html')

# @app.route(rootPath+'/dashboard')
# def dashboard():
#     return render_template('dashboard.html')

# @app.route(rootPath+'/getAudioFromText', methods=['POST'])
# def getAudioFromText():
#     try:
#         ensure_lambda_modules()
#         event = {'body': json.dumps(request.get_json(force=True))}
#         res = _lambdaTTS.lambda_handler(event, [])
#         # lambda_handler returns a JSON string; return as response with correct mimetype
#         return Response(res, status=200, mimetype='application/json')
#     except Exception as e:
#         print("getAudioFromText error:", repr(e))
#         return jsonify({'error': str(e)}), 500

# @app.route(rootPath+'/getSample', methods=['POST'])
# def getNext():
#     try:
#         ensure_lambda_modules()
#         print("Request text:", request.get_data(as_text=True))
#         event = {'body':  json.dumps(request.get_json(force=True))}
#         res = _lambdaGetSample.lambda_handler(event, [])
#         # print("Samples:", res)
#         return Response(res, status=200, mimetype='application/json')
#     except Exception as e:
#         print("getSample error:", repr(e))
#         return jsonify({'error': str(e)}), 500
    

# @app.route(rootPath+'/debug_audio', methods=['POST'])
# def debug_audio():
#     """Debug endpoint to check audio processing"""
#     try:
#         data = request.get_json()
#         b64_audio = data.get('base64Audio', '')
        
#         # Decode and save for inspection
#         if ',' in b64_audio:
#             b64_payload = b64_audio.split(',')[1]
#         else:
#             b64_payload = b64_audio
            
#         file_bytes = base64.b64decode(b64_payload)
        
#         debug_path = '/tmp/debug_audio.wav'
#         with open(debug_path, 'wb') as f:
#             f.write(file_bytes)
            
#         # Try to get file info
#         file_size = len(file_bytes)
        
#         return jsonify({
#             'status': 'received',
#             'file_size': file_size,
#             'saved_to': debug_path,
#             'message': f'Audio saved to {debug_path} for inspection'
#         })
#     except Exception as e:
#         return jsonify({'error': str(e)}), 500

# @app.route(rootPath+'/GetAccuracyFromRecordedAudio', methods=['POST'])
# def GetAccuracyFromRecordedAudio():
#     try:
#         ensure_lambda_modules()
#         event = {'body': json.dumps(request.get_json(force=True))}
#         lambda_correct_output = _lambdaSpeechToScore.lambda_handler(event, [])
#         return Response(lambda_correct_output, status=200, mimetype='application/json')
#     except Exception as e:
#         print('GetAccuracyFromRecordedAudio Error: ', repr(e))
#         # Return HTTP 500 with message (front-end will show clearer info)
#         return jsonify({'error': str(e)}), 500

# if __name__ == "__main__":
#     print(os.system('pwd'))
#     webbrowser.open_new('http://127.0.0.1:3000/')
#     app.run(host="0.0.0.0", port=3000)


"""
Speech-to-Score Flask Application
===================================
A REST API server for text-to-speech, audio sampling, and pronunciation scoring.

Endpoints:
    GET  /                              - Main UI
    GET  /dashboard                     - Dashboard UI
    POST /getAudioFromText              - Convert text to audio
    POST /getSample                     - Fetch a pronunciation sample
    POST /GetAccuracyFromRecordedAudio  - Score recorded pronunciation
    POST /debug_audio                   - Debug: inspect uploaded audio

Usage:
    python app.py
    # Server starts at http://127.0.0.1:3000
"""

import importlib
import io
import json
import os
import base64
import webbrowser
from typing import Any

# ---------------------------------------------------------------------------
# Environment & encoding patch (must run before pandas import)
# ---------------------------------------------------------------------------

os.environ["PYTHONUTF8"] = "1"

import pandas as _pd  # noqa: E402 (intentional late import after env var)

# ---------------------------------------------------------------------------
# CSV Encoding Patch
# Monkey-patches pandas.read_csv to auto-detect encoding, falling back
# through a priority list: utf-8 → utf-8-sig → latin-1 → cp1252
# ---------------------------------------------------------------------------

_FALLBACK_ENCODINGS = ["utf-8", "utf-8-sig", "latin-1", "cp1252"]
_orig_read_csv = _pd.read_csv
_charset_detector = None

try:
    from charset_normalizer import from_bytes as _cn_from_bytes

    def _charset_detector(data: bytes) -> str | None:
        """Return the best-guess encoding for raw bytes, or None."""
        result = _cn_from_bytes(data).best()
        return result.encoding if result else None

except ImportError:
    pass  # charset_normalizer not installed; fall back to manual list


def _read_csv_auto_encoding(*args, **kwargs) -> _pd.DataFrame:
    """
    Wrapper around pandas.read_csv that auto-detects file encoding.

    If the caller has already specified ``encoding=``, the original
    function is called unchanged.  Otherwise, a list of common encodings
    is tried in order (with optional charset-normalizer detection first).
    """
    # Respect explicit encoding from caller
    if "encoding" in kwargs or not args:
        return _orig_read_csv(*args, **kwargs)

    source = args[0]

    # --- File-like object ---
    if hasattr(source, "read") and callable(source.read):
        name = getattr(source, "name", None)

        # If it's a named path on disk, re-open by path for reliability
        if isinstance(name, str) and os.path.exists(name):
            for enc in _FALLBACK_ENCODINGS:
                try:
                    return _orig_read_csv(name, encoding=enc, **kwargs)
                except UnicodeDecodeError:
                    continue
            return _orig_read_csv(name, **kwargs)  # last-ditch fallback

        # Generic file-like: read bytes then decode
        try:
            data = source.read()
        except Exception:
            for enc in _FALLBACK_ENCODINGS:
                try:
                    return _orig_read_csv(*args, encoding=enc, **kwargs)
                except Exception:
                    pass
            return _orig_read_csv(*args, **kwargs)

        if isinstance(data, bytes):
            if _charset_detector:
                detected = _charset_detector(data)
                if detected:
                    try:
                        return _orig_read_csv(io.StringIO(data.decode(detected)), **kwargs)
                    except Exception:
                        pass
            for enc in _FALLBACK_ENCODINGS:
                try:
                    return _orig_read_csv(io.StringIO(data.decode(enc)), **kwargs)
                except Exception:
                    continue
            raise UnicodeDecodeError("utf-8", data, 0, 1,
                                     "Could not decode file with any known encoding")
        else:
            return _orig_read_csv(io.StringIO(data), **kwargs)

    # --- Path-like string/Path object ---
    last_err: Exception | None = None
    for enc in _FALLBACK_ENCODINGS:
        try:
            return _orig_read_csv(*args, encoding=enc, **kwargs)
        except UnicodeDecodeError as exc:
            last_err = exc
        except Exception:
            raise
    if last_err:
        raise last_err
    return _orig_read_csv(*args, **kwargs)


_pd.read_csv = _read_csv_auto_encoding  # apply patch

# ---------------------------------------------------------------------------
# Flask application setup
# ---------------------------------------------------------------------------

from flask import Flask, Response, jsonify, render_template, request  # noqa: E402
from flask_cors import CORS  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HOST = "0.0.0.0"
PORT = 3000
DEBUG_AUDIO_PATH = "/tmp/debug_audio.wav"

# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

app = Flask(__name__)
CORS(app)
app.config["CORS_HEADERS"] = "*"

# ---------------------------------------------------------------------------
# Lazy-loaded lambda modules
# These are only imported on first use to avoid heavy startup costs and to
# prevent crashes if panphon/epitran aren't installed yet.
# ---------------------------------------------------------------------------

_lambda_modules: dict[str, Any] = {}

_LAMBDA_MODULE_NAMES = {
    "tts": "lambdaTTS",
    "score": "lambdaSpeechToScore",
    "sample": "lambdaGetSample",
}


def get_lambda(name: str) -> Any:
    """
    Return a lazily-imported lambda module by short name.

    Args:
        name: One of 'tts', 'score', or 'sample'.

    Returns:
        The imported module object.

    Raises:
        KeyError: If ``name`` is not a recognised module key.
    """
    if name not in _lambda_modules:
        module_name = _LAMBDA_MODULE_NAMES[name]
        _lambda_modules[name] = importlib.import_module(module_name)
    return _lambda_modules[name]


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

def build_lambda_event(payload: dict) -> dict:
    """Wrap a dict payload in the Lambda-style event envelope."""
    return {"body": json.dumps(payload)}


def lambda_response(raw: str, status: int = 200) -> Response:
    """Return a Flask Response wrapping a raw JSON string from a lambda handler."""
    return Response(raw, status=status, mimetype="application/json")


# ---------------------------------------------------------------------------
# Routes – UI
# ---------------------------------------------------------------------------

@app.route("/")
def index() -> str:
    """Serve the main UI page."""
    return render_template("main.html")


@app.route("/dashboard")
def dashboard() -> str:
    """Serve the dashboard UI page."""
    return render_template("dashboard.html")


# ---------------------------------------------------------------------------
# Routes – API
# ---------------------------------------------------------------------------

@app.route("/getAudioFromText", methods=["POST"])
def get_audio_from_text() -> Response:
    """
    Convert text to synthesised speech audio.

    Request body (JSON):
        { "text": "<string to synthesise>" }

    Returns:
        JSON response from the TTS lambda handler.
    """
    try:
        event = build_lambda_event(request.get_json(force=True))
        result = get_lambda("tts").lambda_handler(event, [])
        return lambda_response(result)
    except Exception as exc:
        app.logger.exception("getAudioFromText failed")
        return jsonify({"error": str(exc)}), 500


@app.route("/getSample", methods=["POST"])
def get_sample() -> Response:
    """
    Fetch a pronunciation practice sample.

    Request body (JSON):
        { "language": "<language code>", ... }

    Returns:
        JSON response from the sample lambda handler.
    """
    try:
        app.logger.debug("getSample body: %s", request.get_data(as_text=True))
        event = build_lambda_event(request.get_json(force=True))
        result = get_lambda("sample").lambda_handler(event, [])
        return lambda_response(result)
    except Exception as exc:
        app.logger.exception("getSample failed")
        return jsonify({"error": str(exc)}), 500


@app.route("/GetAccuracyFromRecordedAudio", methods=["POST"])
def get_accuracy_from_recorded_audio() -> Response:
    """
    Score a user's recorded pronunciation against the target text.

    Request body (JSON):
        {
            "base64Audio": "<data URI or raw base64>",
            "title":       "<expected text>"
        }

    Returns:
        JSON response with accuracy/scoring data from the scoring lambda.
    """
    try:
        event = build_lambda_event(request.get_json(force=True))
        result = get_lambda("score").lambda_handler(event, [])
        return lambda_response(result)
    except Exception as exc:
        app.logger.exception("GetAccuracyFromRecordedAudio failed")
        return jsonify({"error": str(exc)}), 500


@app.route("/debug_audio", methods=["POST"])
def debug_audio() -> Response:
    """
    Debug endpoint: save uploaded audio to disk for local inspection.

    Accepts a base64-encoded audio payload and writes it to
    ``DEBUG_AUDIO_PATH`` so developers can inspect it with external tools.

    Request body (JSON):
        { "base64Audio": "<data URI or raw base64 WAV>" }

    Returns:
        JSON with file size and save path.
    """
    try:
        data = request.get_json(force=True)
        b64_audio: str = data.get("base64Audio", "")

        # Strip optional data-URI prefix (e.g. "data:audio/wav;base64,")
        b64_payload = b64_audio.split(",", 1)[-1] if "," in b64_audio else b64_audio

        audio_bytes = base64.b64decode(b64_payload)

        with open(DEBUG_AUDIO_PATH, "wb") as fh:
            fh.write(audio_bytes)

        return jsonify({
            "status": "received",
            "file_size_bytes": len(audio_bytes),
            "saved_to": DEBUG_AUDIO_PATH,
            "message": f"Audio written to {DEBUG_AUDIO_PATH}. "
                       "Inspect with: ffprobe /tmp/debug_audio.wav",
        })
    except Exception as exc:
        app.logger.exception("debug_audio failed")
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.logger.info("Working directory: %s", os.getcwd())
    webbrowser.open_new(f"http://127.0.0.1:{PORT}/")
    app.run(host=HOST, port=PORT, debug=False)