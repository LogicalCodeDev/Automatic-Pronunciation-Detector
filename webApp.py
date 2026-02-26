import io
import os
os.environ["PYTHONUTF8"] = "1"  
import pandas as _pd

_orig_read_csv = _pd.read_csv
_try_detector = None
try:
    from charset_normalizer import from_bytes
    def _detect_encoding_bytes(b):
        r = from_bytes(b).best()
        return r.encoding if r else None
    _try_detector = _detect_encoding_bytes
except Exception:
    _try_detector = None

def _read_csv_force_utf8(*args, **kwargs):
    # If caller explicitly provided encoding, respect it
    if 'encoding' in kwargs or len(args) == 0:
        return _orig_read_csv(*args, **kwargs)

    encodings = ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252']
    first = args[0]

    # Detect file-like objects (has .read)
    if hasattr(first, 'read') and callable(first.read):
        # If file-like has .name and it's a real path, reopen it by path
        name = getattr(first, 'name', None)
        if isinstance(name, str) and os.path.exists(name):
            for enc in encodings:
                try:
                    return _orig_read_csv(name, encoding=enc, **kwargs)
                except UnicodeDecodeError:
                    continue
            # fallback
            return _orig_read_csv(name, **kwargs)

        # Otherwise read bytes/text and decode ourselves
        try:
            data = first.read()
        except Exception:
            # Can't read: fallback to trying pandas with encodings
            for enc in encodings:
                try:
                    return _orig_read_csv(*args, encoding=enc, **kwargs)
                except Exception:
                    pass
            return _orig_read_csv(*args, **kwargs)

        if isinstance(data, bytes):
            # try detector
            if _try_detector:
                enc = _try_detector(data)
                if enc:
                    try:
                        return _orig_read_csv(io.StringIO(data.decode(enc)), **kwargs)
                    except Exception:
                        pass
            for enc in encodings:
                try:
                    return _orig_read_csv(io.StringIO(data.decode(enc)), **kwargs)
                except Exception:
                    continue
            raise UnicodeDecodeError("Could not decode file-like object with tried encodings")
        else:
            # already text
            return _orig_read_csv(io.StringIO(data), **kwargs)

    else:
        # path-like: try encodings
        last_err = None
        for enc in encodings:
            try:
                return _orig_read_csv(*args, encoding=enc, **kwargs)
            except UnicodeDecodeError as e:
                last_err = e
                continue
            except Exception:
                raise
        if last_err:
            raise last_err
        return _orig_read_csv(*args, **kwargs)

_pd.read_csv = _read_csv_force_utf8
# ---------------------------------------------------------------------------

# Standard Flask imports
from flask import Flask, render_template, request, jsonify, Response
from flask_cors import CORS
import json
import importlib
import webbrowser
import base64

app = Flask(__name__)
cors = CORS(app)
app.config['CORS_HEADERS'] = '*'

# lazy-loaded modules (avoid heavy imports at startup)
_lambdaTTS = None
_lambdaSpeechToScore = None
_lambdaGetSample = None

def ensure_lambda_modules():
    global _lambdaTTS, _lambdaSpeechToScore, _lambdaGetSample
    if _lambdaTTS is None or _lambdaSpeechToScore is None or _lambdaGetSample is None:
        # import only when needed (prevents startup failures if panphon/epitran break)
        _lambdaTTS = importlib.import_module("lambdaTTS")
        _lambdaSpeechToScore = importlib.import_module("lambdaSpeechToScore")
        _lambdaGetSample = importlib.import_module("lambdaGetSample")

rootPath = ''

@app.route(rootPath+'/')
def main():
    return render_template('main.html')

@app.route(rootPath+'/getAudioFromText', methods=['POST'])
def getAudioFromText():
    try:
        ensure_lambda_modules()
        event = {'body': json.dumps(request.get_json(force=True))}
        res = _lambdaTTS.lambda_handler(event, [])
        # lambda_handler returns a JSON string; return as response with correct mimetype
        return Response(res, status=200, mimetype='application/json')
    except Exception as e:
        print("getAudioFromText error:", repr(e))
        return jsonify({'error': str(e)}), 500

@app.route(rootPath+'/getSample', methods=['POST'])
def getNext():
    try:
        ensure_lambda_modules()
        print("Request text:", request.get_data(as_text=True))
        event = {'body':  json.dumps(request.get_json(force=True))}
        res = _lambdaGetSample.lambda_handler(event, [])
        # print("Samples:", res)
        return Response(res, status=200, mimetype='application/json')
    except Exception as e:
        print("getSample error:", repr(e))
        return jsonify({'error': str(e)}), 500
    

@app.route(rootPath+'/debug_audio', methods=['POST'])
def debug_audio():
    """Debug endpoint to check audio processing"""
    try:
        data = request.get_json()
        b64_audio = data.get('base64Audio', '')
        
        # Decode and save for inspection
        if ',' in b64_audio:
            b64_payload = b64_audio.split(',')[1]
        else:
            b64_payload = b64_audio
            
        file_bytes = base64.b64decode(b64_payload)
        
        debug_path = '/tmp/debug_audio.wav'
        with open(debug_path, 'wb') as f:
            f.write(file_bytes)
            
        # Try to get file info
        file_size = len(file_bytes)
        
        return jsonify({
            'status': 'received',
            'file_size': file_size,
            'saved_to': debug_path,
            'message': f'Audio saved to {debug_path} for inspection'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route(rootPath+'/GetAccuracyFromRecordedAudio', methods=['POST'])
def GetAccuracyFromRecordedAudio():
    try:
        ensure_lambda_modules()
        event = {'body': json.dumps(request.get_json(force=True))}
        lambda_correct_output = _lambdaSpeechToScore.lambda_handler(event, [])
        return Response(lambda_correct_output, status=200, mimetype='application/json')
    except Exception as e:
        print('GetAccuracyFromRecordedAudio Error: ', repr(e))
        # Return HTTP 500 with message (front-end will show clearer info)
        return jsonify({'error': str(e)}), 500

if __name__ == "__main__":
    print(os.system('pwd'))
    webbrowser.open_new('http://127.0.0.1:3000/')
    app.run(host="0.0.0.0", port=3000)
