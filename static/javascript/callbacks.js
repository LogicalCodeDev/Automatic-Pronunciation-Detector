
let recordingReferenceSnapshot = null; 
// Audio context initialization
let mediaRecorder, audioChunks, audioBlob, stream, audioRecorded;
const ctx = new AudioContext();
let currentAudioForPlaying;
let lettersOfWordAreCorrect = [];

// UI-related variables
const page_title = "AI Pronunciation Trainer";
const accuracy_colors = ["green", "orange", "red"];
let badScoreThreshold = 30;
let mediumScoreThreshold = 70;
let currentSample = 0;
let currentScore = 0.;
let sample_difficult = 0;
let scoreMultiplier = 1;
let playAnswerSounds = true;
let isNativeSelectedForPlayback = true;
let isRecording = false;
let serverIsInitialized = false;
let serverWorking = true;
let languageFound = true;
let currentSoundRecorded = false;
let currentText, currentIpa, real_transcripts_ipa, matched_transcripts_ipa;
let wordCategories;
let startTime, endTime;

// API related variables 
let AILanguage = "en"; // Standard is English


let STScoreAPIKey = 'rll5QsTiv83nti99BW6uCmvs9BDVxSB39SVFceYb'; // Public Key. If, for some reason, you would like a private one, send-me a message and we can discuss some possibilities
let apiMainPathSample = '';// 'http://127.0.0.1:3001';// 'https://a3hj0l2j2m.execute-api.eu-central-1.amazonaws.com/Prod';
let apiMainPathSTS = '';// 'https://wrg7ayuv7i.execute-api.eu-central-1.amazonaws.com/Prod';


// Variables to playback accuracy sounds
let soundsPath = '../static';//'https://stscore-sounds-bucket.s3.eu-central-1.amazonaws.com';
let soundFileGood = null;
let soundFileOkay = null;
let soundFileBad = null;

// Speech generation
var synth = window.speechSynthesis;
let voice_idx = 0;
let voice_synth = null;

//############################ UI general control functions ###################
const unblockUI = () => {
    document.getElementById("recordAudio").classList.remove('disabled');
    document.getElementById("playSampleAudio").classList.remove('disabled');
    document.getElementById("buttonNext").onclick = () => getNextSample();
    document.getElementById("nextButtonDiv").classList.remove('disabled');
    document.getElementById("original_script").classList.remove('disabled');
    document.getElementById("buttonNext").style["background-color"] = '#58636d';

    if (currentSoundRecorded)
        document.getElementById("playRecordedAudio").classList.remove('disabled');


};

const blockUI = () => {

    document.getElementById("recordAudio").classList.add('disabled');
    document.getElementById("playSampleAudio").classList.add('disabled');
    document.getElementById("buttonNext").onclick = null;
    document.getElementById("original_script").classList.add('disabled');
    document.getElementById("playRecordedAudio").classList.add('disabled');

    document.getElementById("buttonNext").style["background-color"] = '#adadad';


};

const UIError = () => {
    blockUI();
    document.getElementById("buttonNext").onclick = () => getNextSample(); //If error, user can only try to get a new sample
    document.getElementById("buttonNext").style["background-color"] = '#58636d';

    document.getElementById("recorded_ipa_script").innerHTML = "";
    document.getElementById("single_word_ipa_pair").innerHTML = "Error";
    document.getElementById("ipa_script").innerHTML = "Error"

    document.getElementById("main_title").innerHTML = 'Server Error';
    document.getElementById("original_script").innerHTML = 'Server error. Either the daily quota of the server is over or there was some internal error. You can try to generate a new sample in a few seconds. If the error persist, try comming back tomorrow';
};

const UINotSupported = () => {
    unblockUI();

    document.getElementById("main_title").innerHTML = "Browser unsupported";

}

const UIRecordingError = () => {
    unblockUI();
    document.getElementById("main_title").innerHTML = "Recording error, please try again or restart page.";
    startMediaDevice();
}



//################### Application state functions #######################
function updateScore(currentPronunciationScore) {

    if (isNaN(currentPronunciationScore))
        return;
    currentScore += currentPronunciationScore * scoreMultiplier;
    currentScore = Math.round(currentScore);
}

const cacheSoundFiles = async () => {
    await fetch(soundsPath + '/ASR_good.wav').then(data => data.arrayBuffer()).
        then(arrayBuffer => ctx.decodeAudioData(arrayBuffer)).
        then(decodeAudioData => {
            soundFileGood = decodeAudioData;
        });

    await fetch(soundsPath + '/ASR_okay.wav').then(data => data.arrayBuffer()).
        then(arrayBuffer => ctx.decodeAudioData(arrayBuffer)).
        then(decodeAudioData => {
            soundFileOkay = decodeAudioData;
        });

    await fetch(soundsPath + '/ASR_bad.wav').then(data => data.arrayBuffer()).
        then(arrayBuffer => ctx.decodeAudioData(arrayBuffer)).
        then(decodeAudioData => {
            soundFileBad = decodeAudioData;
        });
}

// const getNextSample = async () => {



//     blockUI();

//     if (!serverIsInitialized)
//         await initializeServer();

//     if (!serverWorking) {
//         UIError();
//         return;
//     }

//     if (soundFileBad == null)
//         cacheSoundFiles();



//     updateScore(parseFloat(document.getElementById("pronunciation_accuracy").innerHTML));

//     document.getElementById("main_title").innerHTML = "Processing new sample...";

//     if (document.getElementById('lengthCat1').checked) {
//         sample_difficult = 0;
//         scoreMultiplier = 1.3;
//     }
//     else if (document.getElementById('lengthCat2').checked) {
//         sample_difficult = 1;
//         scoreMultiplier = 1;
//     }
//     else if (document.getElementById('lengthCat3').checked) {
//         sample_difficult = 2;
//         scoreMultiplier = 1.3;
//     }
//     else if (document.getElementById('lengthCat4').checked) {
//         sample_difficult = 3;
//         scoreMultiplier = 1.6;
//     }

//     try {
//         console.log("Here2!",apiMainPathSample)
//         await fetch(apiMainPathSample + '/getSample', {
//             method: "post",
//             body: JSON.stringify({
//                 "category": sample_difficult.toString(), "language": AILanguage
//             }),
//             headers: { "X-Api-Key": STScoreAPIKey }
//         }).then(res => res.json()).
//             then(data => {
//                 let doc = document.getElementById("original_script");
//                 currentText = data.real_transcript;
//                 doc.innerHTML = currentText;

//                 currentIpa = data.ipa_transcript

//                 let doc_ipa = document.getElementById("ipa_script");
//                 doc_ipa.innerHTML = "/ " + currentIpa + " /";

//                 document.getElementById("recorded_ipa_script").innerHTML = ""
//                 document.getElementById("pronunciation_accuracy").innerHTML = "";
//                 document.getElementById("single_word_ipa_pair").innerHTML = "Reference | Spoken"
//                 document.getElementById("section_accuracy").innerHTML = "| Score: " + currentScore.toString() + " - (" + currentSample.toString() + ")";
//                 currentSample += 1;

//                 document.getElementById("main_title").innerHTML = page_title;

//                 document.getElementById("translated_script").innerHTML = data.transcript_translation;

//                 currentSoundRecorded = false;
//                 unblockUI();
//                 document.getElementById("playRecordedAudio").classList.add('disabled');

//             })
//     }
//     catch(err)
//     {
//         console.log(err)
//         UIError();
//     }


// };


const getNextSample = async () => {
    blockUI();

    if (!serverIsInitialized) await initializeServer();

    if (!serverWorking) {
        UIError();
        return;
    }

    if (soundFileBad == null) cacheSoundFiles();

    // safe parse of current displayed score (may be empty)
    const rawScore = document.getElementById("pronunciation_accuracy")?.innerHTML || "0";
    updateScore(parseFloat(rawScore) || 0);

    const mainTitleEl = document.getElementById("main_title");
    if (mainTitleEl) mainTitleEl.innerHTML = "Processing new sample...";

    // determine difficulty & multiplier
    if (document.getElementById('lengthCat1')?.checked) {
        sample_difficult = 0; scoreMultiplier = 1.3;
    } else if (document.getElementById('lengthCat2')?.checked) {
        sample_difficult = 1; scoreMultiplier = 1;
    } else if (document.getElementById('lengthCat3')?.checked) {
        sample_difficult = 2; scoreMultiplier = 1.3;
    } else if (document.getElementById('lengthCat4')?.checked) {
        sample_difficult = 3; scoreMultiplier = 1.6;
    }

    try {
        console.log("Fetching sample (category=" + sample_difficult + ", lang=" + AILanguage + ")");
        const res = await fetch((apiMainPathSample || '') + '/getSample', {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Api-Key": STScoreAPIKey
            },
            body: JSON.stringify({
                "category": sample_difficult.toString(),
                "language": AILanguage
            }),
        });

        // read as text first to handle empty or non-json responses gracefully
        const resText = await res.text();
        // console.log(resText)

        if (!res.ok) {
            console.error("getSample failed:", res.status, resText);
            // try parse server error JSON if present
            try {
                const errObj = JSON.parse(resText || "{}");
                throw new Error(errObj.error || `Server ${res.status}`);
            } catch (parseErr) {
                throw new Error(`Server ${res.status}: ${resText || res.statusText}`);
            }
        }

        if (!resText) {
            throw new Error("Empty response from server");
        }

        const data = JSON.parse(resText);
        console.log(data)

        if (data.error) {
            throw new Error("Backend error: " + data.error);
        }

        // find original_script element safely
        const doc = document.getElementById("original_script");
        if (!doc) {
            console.warn("Element #original_script not found in DOM. Aborting DOM update.", data);
            // still update internal value so other logic can use it
            currentText = Array.isArray(data.real_transcript) ? data.real_transcript[0] : data.real_transcript;
            // unblock UI so user can try again
            unblockUI();
            return;
        }
        console.log(doc)
        // set transcript (support both string and array payloads)
        currentText = Array.isArray(data.real_transcript) ? data.real_transcript[0] : data.real_transcript;
        doc.innerHTML = currentText ?? "";

        currentIpa = data.ipa_transcript ?? "";
        const doc_ipa = document.getElementById("ipa_script");
        if (doc_ipa) doc_ipa.innerHTML = "/ " + currentIpa + " /";

        const recIpa = document.getElementById("recorded_ipa_script");
        if (recIpa) recIpa.innerHTML = "";

        const pronEl = document.getElementById("pronunciation_accuracy");
        if (pronEl) pronEl.innerHTML = "";

        const singlePair = document.getElementById("single_word_ipa_pair");
        if (singlePair) singlePair.innerHTML = "Reference | Spoken";

        const sectionAcc = document.getElementById("section_accuracy");
        if (sectionAcc) sectionAcc.innerHTML = "| Score: " + currentScore.toString() + " - (" + currentSample.toString() + ")";

        currentSample += 1;

        if (mainTitleEl) mainTitleEl.innerHTML = page_title;

        const translated = document.getElementById("translated_script");
        if (translated) translated.innerHTML = data.transcript_translation ?? "";

        currentSoundRecorded = false;
        unblockUI();

        const playRecBtn = document.getElementById("playRecordedAudio");
        // console.log(playRecordedAudio)
        if (playRecBtn) playRecBtn.classList.add('disabled');

    } catch (err) {
        console.error("getNextSample error:", err);
        // give the user a meaningful UI error
        UIError(err.message || err);
    }
};


const testAudioProcessing = async () => {
    console.log("=== Starting Audio Processing Test ===");
    
    // Update UI to show testing state
    document.getElementById("main_title").innerHTML = "Testing Audio Pipeline...";
    blockUI();

    try {
        // Ensure media recorder is ready
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            console.log("Initializing media device for test...");
            await startMediaDevice();
        }

        console.log("Starting test recording (2 seconds)...");
        audioChunks = [];
        isRecording = true;
        
        // Start recording
        mediaRecorder.start();
        
        // Record for 2 seconds
        await new Promise(resolve => {
            setTimeout(() => {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                    isRecording = false;
                    console.log("Test recording stopped");
                }
                resolve();
            }, 2000);
        });

        // Wait a bit for recording to process
        await new Promise(resolve => setTimeout(resolve, 500));

        if (!audioChunks || audioChunks.length === 0) {
            throw new Error("No audio data recorded");
        }

        // Create blob and convert to base64
        audioBlob = new Blob(audioChunks, { type: 'audio/ogg;' });
        const audioBase64 = await convertBlobToBase64(audioBlob);
        
        console.log("Test audio base64 length:", audioBase64.length);
        console.log("First 100 chars of base64:", audioBase64.substring(0, 100));

        // Test 1: Send to debug endpoint
        console.log("Sending to debug endpoint...");
        const debugResponse = await fetch(apiMainPathSTS + '/debug_audio', {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ "base64Audio": audioBase64 })
        });
        
        const debugResult = await debugResponse.json();
        console.log("Debug endpoint result:", debugResult);

        // Test 2: Try actual processing with a simple word
        console.log("Testing actual pronunciation processing...");
        const testText = "Hello";
        const processResponse = await fetch(apiMainPathSTS + '/GetAccuracyFromRecordedAudio', {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "X-Api-Key": STScoreAPIKey 
            },
            body: JSON.stringify({ 
                "title": testText, 
                "base64Audio": audioBase64, 
                "language": AILanguage 
            })
        });
        
        const processResult = await processResponse.json();
        console.log("Processing result:", processResult);

        // Update UI with test results
        document.getElementById("main_title").innerHTML = `Test Complete - Check Console`;
        console.log("=== Audio Processing Test Complete ===");

    } catch (error) {
        console.error("Test failed:", error);
        document.getElementById("main_title").innerHTML = "Test Failed - Check Console";
    } finally {
        unblockUI();
        // Reset after a delay
        setTimeout(() => {
            document.getElementById("main_title").innerHTML = page_title;
        }, 3000);
    }
};


const updateRecordingState = async () => {

    if (isRecording) {
        stopRecording();
        return
    }
    else {
        if (!mediaRecorder) {
            await startMediaDevice();
        }
        recordSample();
        return;
    }
}

const generateWordModal = (word_idx) => {

    document.getElementById("single_word_ipa_pair").innerHTML = wrapWordForPlayingLink(real_transcripts_ipa[word_idx], word_idx, false, "black")
        + ' | ' + wrapWordForPlayingLink(matched_transcripts_ipa[word_idx], word_idx, true, accuracy_colors[parseInt(wordCategories[word_idx])])
}

// const recordSample = async () => {

//     document.getElementById("main_title").innerHTML = "Recording... click again when done speaking";
//     document.getElementById("recordIcon").innerHTML = 'pause_presentation';
//     blockUI();
//     document.getElementById("recordAudio").classList.remove('disabled');
//     audioChunks = [];
//     isRecording = true;
//     // startMediaDevice();
//     if (mediaRecorder) {
//         mediaRecorder.start();
//     } else {
//         console.error("mediaRecorder not initialized — call startMediaDevice() first.");
//     }


// }


const recordSample = async () => {
    // snapshot current reference text the moment recording starts
    try {
        // Prefer using your internal currentText (set by getNextSample). If not set, fallback to DOM textContent.
        console.log(currentText)
        if (typeof currentText !== 'undefined' && currentText) {
            recordingReferenceSnapshot = currentText.toString().trim();
        } else {
            const el = document.getElementById("original_script");
            recordingReferenceSnapshot = el ? el.textContent.trim() : "";
        }
        console.log("Recording snapshot:", recordingReferenceSnapshot);
    } catch (err) {
        console.warn("Failed to capture recording snapshot:", err);
        recordingReferenceSnapshot = "";
    }

    document.getElementById("main_title").innerHTML = "Recording... click again when done speaking";
    document.getElementById("recordIcon").innerHTML = 'pause_presentation';
    blockUI();
    document.getElementById("recordAudio").classList.remove('disabled');
    audioChunks = [];
    isRecording = true;
    // startMediaDevice() should already have been called
    if (mediaRecorder) {
        mediaRecorder.start();
    } else {
        console.error("mediaRecorder not initialized — call startMediaDevice() first.");
    }
}


const changeLanguage = (language, generateNewSample = false) => {
    voices = synth.getVoices();
    AILanguage = language;
    languageFound = false;
    let languageIdentifier, languageName;
    switch (language) {
        case 'de':

            document.getElementById("languageBox").innerHTML = "German";
            languageIdentifier = 'de';
            languageName = 'Anna';
            break;

        case 'en':

            document.getElementById("languageBox").innerHTML = "English";
            languageIdentifier = 'en';
            languageName = 'Daniel';
            break;
        case 'hi':

            document.getElementById("languageBox").innerHTML = "Hindi";
            languageIdentifier = 'hi';
            languageName = 'Rahul';
            break;
        case 'mr':

            document.getElementById("languageBox").innerHTML = "Marathi";
            languageIdentifier = 'mr';
            languageName = 'Narendra';
            break;
    };

    for (idx = 0; idx < voices.length; idx++) {
        if (voices[idx].lang.slice(0, 2) == languageIdentifier && voices[idx].name == languageName) {
            voice_synth = voices[idx];
            languageFound = true;
            break;
        }

    }
    // If specific voice not found, search anything with the same language 
    if (!languageFound) {
        for (idx = 0; idx < voices.length; idx++) {
            if (voices[idx].lang.slice(0, 2) == languageIdentifier) {
                voice_synth = voices[idx];
                languageFound = true;
                break;
            }
        }
    }
    if (generateNewSample)
        getNextSample();
}

//################### Speech-To-Score function ########################
const mediaStreamConstraints = {
    audio: {
        channelCount: 1,
        sampleRate: 16000,  // Match backend expected sample rate
        sampleSize: 16,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    }
}


// const startMediaDevice = () => {
//     navigator.mediaDevices.getUserMedia(mediaStreamConstraints).then(_stream => {
//         stream = _stream
//         mediaRecorder = new MediaRecorder(stream);

//         let currentSamples = 0
//         mediaRecorder.ondataavailable = event => {

//             // currentSamples += event.data.length
//             // audioChunks.push(event.data);

//             currentSamples += (event.data && typeof event.data.size === 'number') ? event.data.size : 0;
//             audioChunks.push(event.data);
//         };
//         // console.log("Pratham")
//         mediaRecorder.onstop = async () => {


//             document.getElementById("recordIcon").innerHTML = 'mic';
//             blockUI();


//             audioBlob = new Blob(audioChunks, { type: 'audio/ogg;' });

//             let audioUrl = URL.createObjectURL(audioBlob);
//             audioRecorded = new Audio(audioUrl);

//             let audioBase64 = await convertBlobToBase64(audioBlob);

//             let minimumAllowedLength = 6;
//             if (audioBase64.length < minimumAllowedLength) {
//                 setTimeout(UIRecordingError, 50); // Make sure this function finished after get called again
//                 return;
//             }

//             try {
//                 // Get currentText from "original_script" div, in case user has change it
//                 let text = document.getElementById("original_script").innerHTML;
//                 // Remove html tags
//                 text = text.replace(/<[^>]*>?/gm, '');
//                 //Remove spaces on the beginning and end
//                 text = text.trim();
//                 // Remove double spaces
//                 text = text.replace(/\s\s+/g, ' ');
//                 currentText = [text];

//                 await fetch(apiMainPathSTS + '/GetAccuracyFromRecordedAudio', {
//                     method: "post",
//                     body: JSON.stringify({ "title": currentText[0], "base64Audio": audioBase64, "language": AILanguage }),
//                     headers: { "X-Api-Key": STScoreAPIKey }

//                 }).then(res => res.json()).
//                     then(data => {

//                         if (playAnswerSounds)
//                             playSoundForAnswerAccuracy(parseFloat(data.pronunciation_accuracy))

//                         document.getElementById("recorded_ipa_script").innerHTML = "/ " + data.ipa_transcript + " /";
//                         document.getElementById("recordAudio").classList.add('disabled');
//                         document.getElementById("main_title").innerHTML = page_title;
//                         document.getElementById("pronunciation_accuracy").innerHTML = data.pronunciation_accuracy + "%";
//                         document.getElementById("ipa_script").innerHTML = data.real_transcripts_ipa

//                         lettersOfWordAreCorrect = data.is_letter_correct_all_words.split(" ")


//                         startTime = data.start_time;
//                         endTime = data.end_time;


//                         real_transcripts_ipa = data.real_transcripts_ipa.split(" ")
//                         matched_transcripts_ipa = data.matched_transcripts_ipa.split(" ")
//                         wordCategories = data.pair_accuracy_category.split(" ")
//                         let currentTextWords = currentText[0].split(" ")

//                         coloredWords = "";
//                         for (let word_idx = 0; word_idx < currentTextWords.length; word_idx++) {

//                             wordTemp = '';
//                             for (let letter_idx = 0; letter_idx < currentTextWords[word_idx].length; letter_idx++) {
//                                 letter_is_correct = lettersOfWordAreCorrect[word_idx][letter_idx] == '1'
//                                 if (letter_is_correct)
//                                     color_letter = 'green'
//                                 else
//                                     color_letter = 'red'

//                                 wordTemp += '<font color=' + color_letter + '>' + currentTextWords[word_idx][letter_idx] + "</font>"
//                             }
//                             currentTextWords[word_idx]
//                             coloredWords += " " + wrapWordForIndividualPlayback(wordTemp, word_idx)
//                         }



//                         document.getElementById("original_script").innerHTML = coloredWords

//                         currentSoundRecorded = true;
//                         unblockUI();
//                         document.getElementById("playRecordedAudio").classList.remove('disabled');

//                     });
//             }
//             catch {
//                 UIError();
//             }
//         };

//     });
// };


// --- Helper: convert a Blob (recorded audio) into a 16kHz mono PCM WAV data URI ---
async function blobToWav16kBase64(blob) {
  // 1) get ArrayBuffer from blob
  const arrayBuffer = await blob.arrayBuffer();

  // 2) decode audio to AudioBuffer (native sample rate)
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer);

  // 3) resample to 16000 Hz using OfflineAudioContext
  const targetSampleRate = 16000;
  const channels = 1;
  const duration = decoded.duration;
  const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
    channels,
    Math.ceil(duration * targetSampleRate),
    targetSampleRate
  );

  const src = offlineCtx.createBufferSource();
  // convert to mono if needed: create a single-channel buffer with averaged channels
  if (decoded.numberOfChannels === 1) {
    src.buffer = decoded;
  } else {
    // build a mono buffer manually
    const monoBuf = offlineCtx.createBuffer(1, Math.ceil(duration * targetSampleRate), targetSampleRate);
    // read channel data, resample by rendering (we'll fill monoBuf by mixing channels in an intermediate offlineCtx)
    // Easiest: create a temporary buffer in offlineCtx, copy decoded into a multichannel buffer then render
    const tmp = offlineCtx.createBuffer(decoded.numberOfChannels, decoded.length, decoded.sampleRate);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      tmp.copyToChannel(decoded.getChannelData(ch), ch);
    }
    // Create a node to play tmp into the offlineCtx and mix channels into mono by using a GainNode chain
    // Simpler approach: use an intermediate AudioContext to render tmp into offlineCtx (works reliably):
    // But for simplicity, we'll set src.buffer to decoded and let OfflineAudioContext handle resampling; then mix channels to mono after render.
    src.buffer = decoded;
  }

  src.connect(offlineCtx.destination);
  src.start(0);

  const rendered = await offlineCtx.startRendering();

  // rendered is an AudioBuffer at targetSampleRate. Mix to mono if multi-channel
  let channelData;
  if (rendered.numberOfChannels === 1) {
    channelData = rendered.getChannelData(0);
  } else {
    // average channels to mono
    const len = rendered.length;
    channelData = new Float32Array(len);
    for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
      const d = rendered.getChannelData(ch);
      for (let i = 0; i < len; i++) channelData[i] += d[i];
    }
    for (let i = 0; i < len; i++) channelData[i] /= rendered.numberOfChannels;
  }

  // 4) convert Float32 PCM -> 16-bit PCM WAV buffer (Uint8Array)
  function encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    /* RIFF identifier */
    writeString(view, 0, 'RIFF');
    /* file length */
    view.setUint32(4, 36 + samples.length * 2, true);
    /* RIFF type */
    writeString(view, 8, 'WAVE');
    /* format chunk identifier */
    writeString(view, 12, 'fmt ');
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw) */
    view.setUint16(20, 1, true);
    /* channel count */
    view.setUint16(22, 1, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sampleRate * blockAlign) */
    view.setUint32(28, sampleRate * 2, true);
    /* block align (channelCount * bytesPerSample) */
    view.setUint16(32, 2, true);
    /* bits per sample */
    view.setUint16(34, 16, true);
    /* data chunk identifier */
    writeString(view, 36, 'data');
    /* data chunk length */
    view.setUint32(40, samples.length * 2, true);

    // PCM samples
    floatTo16BitPCM(view, 44, samples);

    return new Uint8Array(buffer);
  }

  function floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, input[i]));
      s = s < 0 ? s * 0x8000 : s * 0x7FFF;
      output.setInt16(offset, s, true);
    }
  }

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  const wavBytes = encodeWAV(channelData, targetSampleRate);

  // 5) convert Uint8Array -> base64 (safe for big arrays)
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < wavBytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, wavBytes.subarray(i, i + chunkSize));
  }
  const base64String = btoa(binary);

  // return full data URI, e.g. "data:audio/wav;base64,...."
  return 'data:audio/wav;base64,' + base64String;
}



const startMediaDevice = async () => {
  try {
    // Request microphone access
    stream = await navigator.mediaDevices.getUserMedia(mediaStreamConstraints);
    mediaRecorder = new MediaRecorder(stream);

    // Setup events
    let currentSamples = 0;
    mediaRecorder.ondataavailable = event => {
      currentSamples += (event.data && typeof event.data.size === 'number') ? event.data.size : 0;
      audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
        document.getElementById("recordIcon").innerHTML = 'mic';
        blockUI();

        audioBlob = new Blob(audioChunks, { type: 'audio/ogg;' });
        let audioUrl = URL.createObjectURL(audioBlob);
        audioRecorded = new Audio(audioUrl);

        let audioBase64 = await convertBlobToBase64(audioBlob);

        // QUICK SANITY LOG
        console.log("Prepared audio base64 len:", audioBase64 ? audioBase64.length : 0);

        // Use recorded snapshot as the authoritative title (fallback to DOM if null)
        let titleToSend = (recordingReferenceSnapshot && recordingReferenceSnapshot.length > 0)
                        ? recordingReferenceSnapshot
                        : (() => {
                            let el = document.getElementById("original_script");
                            return el ? el.textContent.replace(/\s\s+/g, ' ').trim() : "";
                            })();

        // Make sure titleToSend is a plain string
        titleToSend = titleToSend.toString().trim();

        // Log exactly what you're about to send
        console.log("Sending title:", titleToSend);

        // validate audioBase64 length
        if (!audioBase64 || audioBase64.length < 50) {
            console.warn("Audio base64 too short, invoking UIRecordingError");
            setTimeout(UIRecordingError, 50);
            return;
        }

        try {
            const res = await fetch(apiMainPathSTS + '/GetAccuracyFromRecordedAudio', {
                method: "post",
                headers: { "X-Api-Key": STScoreAPIKey, "Content-Type": "application/json" },
                body: JSON.stringify({ "title": titleToSend, "base64Audio": audioBase64, "language": AILanguage })
            });

            const data = await res.json();
            
            console.log("Data- ",data)

            if (playAnswerSounds) playSoundForAnswerAccuracy(parseFloat(data.pronunciation_accuracy || 0));

            document.getElementById("recorded_ipa_script").innerHTML = "/ " + (data.ipa_transcript || "") + " /";
            document.getElementById("recordAudio").classList.add('disabled');
            document.getElementById("main_title").innerHTML = page_title;
            document.getElementById("pronunciation_accuracy").innerHTML = (data.pronunciation_accuracy || "") + "%";
            document.getElementById("ipa_script").innerHTML = data.real_transcripts_ipa || "";

            lettersOfWordAreCorrect = (data.is_letter_correct_all_words || "").split(" ");

            startTime = data.start_time || "";
            endTime   = data.end_time   || "";

            real_transcripts_ipa   = (data.real_transcripts_ipa   || "").split(" ");
            matched_transcripts_ipa= (data.matched_transcripts_ipa|| "").split(" ");
            wordCategories          = (data.pair_accuracy_category || "").split(" ");
            const currentTextWords = currentText.split(" ");

            let coloredWords = "";
            for (let word_idx = 0; word_idx < currentTextWords.length; word_idx++) {
            let wordTemp = "";
            const letterInfo = lettersOfWordAreCorrect[word_idx] || "";
            for (let letter_idx = 0; letter_idx < currentTextWords[word_idx].length; letter_idx++) {
                const letter_is_correct = (letterInfo[letter_idx] === '1');
                const color_letter = letter_is_correct ? 'green' : 'red';
                wordTemp += '<font color=' + color_letter + '>' + currentTextWords[word_idx][letter_idx] + "</font>";
            }
            coloredWords += " " + wrapWordForIndividualPlayback(wordTemp, word_idx);
            }
            document.getElementById("original_script").innerHTML = coloredWords;

            currentSoundRecorded = true;
            unblockUI();
            document.getElementById("playRecordedAudio").classList.remove('disabled');
        } catch (err) {
            console.error("Upload/processing error:", err);
            UIError();
        } finally {
            // clear snapshot so next recording uses fresh snapshot
            recordingReferenceSnapshot = null;
        }
    };


    // mediaRecorder.onstop = async () => {
    //     document.getElementById("recordIcon").innerHTML = 'mic';
    //     blockUI();

    //     audioBlob = new Blob(audioChunks, { type: 'audio/ogg;' });
    //     const audioUrl = URL.createObjectURL(audioBlob);
    //     audioRecorded = new Audio(audioUrl);

    //     //   let audioBase64 = await convertBlobToBase64(audioBlob);
    //     let audioBase64 = await blobToWav16kBase64(audioBlob);
    //     console.log({
    //         len: audioBase64.length,
    //         startsWithData: audioBase64.startsWith('data:audio/wav;base64,'),
    //         prefixSample: audioBase64.slice(0,60)
    //         });
        
    //     //   console.log(audioBase64)
    //     if (audioBase64.length < 6) {
    //         setTimeout(UIRecordingError, 50);
    //         return;
    //     }

    //     try {
    //         let text = document.getElementById("original_script").innerHTML;
    //         text = text.replace(/<[^>]*>?/gm, '').trim().replace(/\s\s+/g, ' ');
    //         currentText = [text];
    //         console.log(currentText);

    //         const res = await fetch(apiMainPathSTS + '/GetAccuracyFromRecordedAudio', {
    //         method: "post",
    //         headers: { "X-Api-Key": STScoreAPIKey, "Content-Type": "application/json" },
    //         body: JSON.stringify({ "title": currentText[0], "base64Audio": audioBase64, "language": AILanguage })
    //         });
    //         const data = await res.json();
    //         console.log("Data- ",data)

    //         if (playAnswerSounds) playSoundForAnswerAccuracy(parseFloat(data.pronunciation_accuracy || 0));

    //         document.getElementById("recorded_ipa_script").innerHTML = "/ " + (data.ipa_transcript || "") + " /";
    //         document.getElementById("recordAudio").classList.add('disabled');
    //         document.getElementById("main_title").innerHTML = page_title;
    //         document.getElementById("pronunciation_accuracy").innerHTML = (data.pronunciation_accuracy || "") + "%";
    //         document.getElementById("ipa_script").innerHTML = data.real_transcripts_ipa || "";

    //         lettersOfWordAreCorrect = (data.is_letter_correct_all_words || "").split(" ");

    //         startTime = data.start_time || "";
    //         endTime   = data.end_time   || "";

    //         real_transcripts_ipa   = (data.real_transcripts_ipa   || "").split(" ");
    //         matched_transcripts_ipa= (data.matched_transcripts_ipa|| "").split(" ");
    //         wordCategories          = (data.pair_accuracy_category || "").split(" ");
    //         const currentTextWords = currentText[0].split(" ");

    //         let coloredWords = "";
    //         for (let word_idx = 0; word_idx < currentTextWords.length; word_idx++) {
    //         let wordTemp = "";
    //         const letterInfo = lettersOfWordAreCorrect[word_idx] || "";
    //         for (let letter_idx = 0; letter_idx < currentTextWords[word_idx].length; letter_idx++) {
    //             const letter_is_correct = (letterInfo[letter_idx] === '1');
    //             const color_letter = letter_is_correct ? 'green' : 'red';
    //             wordTemp += '<font color=' + color_letter + '>' + currentTextWords[word_idx][letter_idx] + "</font>";
    //         }
    //         coloredWords += " " + wrapWordForIndividualPlayback(wordTemp, word_idx);
    //         }
    //         document.getElementById("original_script").innerHTML = coloredWords;

    //         currentSoundRecorded = true;
    //         unblockUI();
    //         document.getElementById("playRecordedAudio").classList.remove('disabled');

    //     } catch (err) {
    //         console.error("onstop handler error:", err);
    //         UIError();
    //     }
    // };

    console.log("Media device ready");
  } catch (err) {
    console.error("startMediaDevice failed:", err);
    document.getElementById("main_title").innerHTML = "Microphone access needed — please enable in browser/OS settings.";
    UINotSupported();
  }
};


startMediaDevice();

// ################### Audio playback ##################
const playSoundForAnswerAccuracy = async (accuracy) => {

    currentAudioForPlaying = soundFileGood;
    if (accuracy < mediumScoreThreshold) {
        if (accuracy < badScoreThreshold) {
            currentAudioForPlaying = soundFileBad;
        }
        else {
            currentAudioForPlaying = soundFileOkay;
        }
    }
    playback();

}

const playAudio = async () => {

    document.getElementById("main_title").innerHTML = "Generating sound...";
    console.log(currentText)
    playWithMozillaApi(currentText);
    document.getElementById("main_title").innerHTML = "Current Sound was played";

};

function playback() {
    const playSound = ctx.createBufferSource();
    playSound.buffer = currentAudioForPlaying;
    playSound.connect(ctx.destination);
    playSound.start(ctx.currentTime)
}


const playUserRecording = async (start = null, end = null) => {
    // Defensive checks
    if (!audioRecorded || !currentSoundRecorded) {
        console.warn("No recorded audio available to play.");
        return;
    }

    try {
        blockUI(); // optional: disable UI while playing

        // Ensure the audio element has loaded sufficient data
        if (audioRecorded.readyState < 3) { // HAVE_FUTURE_DATA or higher is preferable
            // wait until canplaythrough or a short timeout
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    // if still not ready, resolve anyway (browser will buffer)
                    resolve();
                }, 1000);

                const onCan = () => {
                    clearTimeout(timeout);
                    audioRecorded.removeEventListener('canplaythrough', onCan);
                    resolve();
                };
                audioRecorded.addEventListener('canplaythrough', onCan);
            });
        }

        // Play entire recording
        if (start == null || end == null) {
            // Ensure play begins from start of file
            audioRecorded.currentTime = 0;
            const playPromise = audioRecorded.play();
            if (playPromise !== undefined) {
                // handle promise rejection (autoplay policies)
                await playPromise.catch(err => {
                    console.warn("play() rejected:", err);
                    unblockUI();
                });
            } else {
                // older browsers: no promise, nothing to wait for
            }

            // unblock UI when audio ends (use once:true to auto-remove)
            audioRecorded.addEventListener('ended', function onEnded() {
                audioRecorded.removeEventListener('ended', onEnded);
                audioRecorded.currentTime = 0;
                unblockUI();
                document.getElementById("main_title").innerHTML = "Recorded Sound was played";
            }, { once: true });

        } else {
            // Play a segment (start & end are in seconds)
            // Clamp times
            const duration = audioRecorded.duration || 0;
            const s = Math.max(0, Math.min(duration, start));
            const e = Math.max(s, Math.min(duration, end));
            audioRecorded.currentTime = s;

            // play and stop after segment duration
            const playPromise = audioRecorded.play();
            if (playPromise !== undefined) {
                await playPromise.catch(err => {
                    console.warn("play() rejected:", err);
                    unblockUI();
                });
            }

            const segMs = Math.round((e - s) * 1000);
            setTimeout(() => {
                try {
                    audioRecorded.pause();
                    audioRecorded.currentTime = 0;
                } catch (err) {
                    console.warn("Error stopping segment playback:", err);
                }
                unblockUI();
                document.getElementById("main_title").innerHTML = "Recorded Sound was played";
            }, segMs);
        }
    } catch (err) {
        console.error("playRecording error:", err);
        unblockUI();
    }
};

const playRecording = async (start = null, end = null) => {
    blockUI();

    try {
        if (start == null || end == null) {
            endTimeInMs = Math.round(audioRecorded.duration * 1000)
            audioRecorded.addEventListener("ended", function () {
                audioRecorded.currentTime = 0;
                unblockUI();
                document.getElementById("main_title").innerHTML = "Recorded Sound was played";
            });
            await audioRecorded.play();

        }
        else {
            audioRecorded.currentTime = start;
            audioRecorded.play();
            durationInSeconds = end - start;
            endTimeInMs = Math.round(durationInSeconds * 1000);
            setTimeout(function () {
                unblockUI();
                audioRecorded.pause();
                audioRecorded.currentTime = 0;
                document.getElementById("main_title").innerHTML = "Recorded Sound was played";
            }, endTimeInMs);

        }
    }
    catch {
        UINotSupported();
    }
};

const playNativeAndRecordedWord = async (word_idx) => {

    if (isNativeSelectedForPlayback)
        playCurrentWord(word_idx)
    else
        playRecordedWord(word_idx);

    isNativeSelectedForPlayback = !isNativeSelectedForPlayback;
}

const stopRecording = () => {
    isRecording = false
    mediaRecorder.stop()
    document.getElementById("main_title").innerHTML = "Processing audio...";
}


const playCurrentWord = async (word_idx) => {

    document.getElementById("main_title").innerHTML = "Generating word...";
    playWithMozillaApi(currentText[0].split(' ')[word_idx]);
    document.getElementById("main_title").innerHTML = "Word was played";
}

// TODO: Check if fallback is correct
const playWithMozillaApi = (text) => {

    if (languageFound) {
        blockUI();
        if (voice_synth == null)
            changeLanguage(AILanguage);

        var utterThis = new SpeechSynthesisUtterance(text);
        utterThis.voice = voice_synth;
        utterThis.rate = 0.7;
        utterThis.onend = function (event) {
            unblockUI();
        }
        synth.speak(utterThis);
    }
    else {
        UINotSupported();
    }
}

const playRecordedWord = (word_idx) => {

    wordStartTime = parseFloat(startTime.split(' ')[word_idx]);
    wordEndTime = parseFloat(endTime.split(' ')[word_idx]);

    playRecording(wordStartTime, wordEndTime);

}

// ############# Utils #####################
const convertBlobToBase64 = async (blob) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // Get the base64 data WITHOUT the data URL prefix
            const dataURL = reader.result;
            const base64 = dataURL.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};


const blobToBase64 = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
});

const wrapWordForPlayingLink = (word, word_idx, isFromRecording, word_accuracy_color) => {
    if (isFromRecording)
        return '<a style = " white-space:nowrap; color:' + word_accuracy_color + '; " href="javascript:playRecordedWord(' + word_idx.toString() + ')"  >' + word + '</a> '
    else
        return '<a style = " white-space:nowrap; color:' + word_accuracy_color + '; " href="javascript:playCurrentWord(' + word_idx.toString() + ')" >' + word + '</a> '
}

const wrapWordForIndividualPlayback = (word, word_idx) => {


    return '<a onmouseover="generateWordModal(' + word_idx.toString() + ')" style = " white-space:nowrap; " href="javascript:playNativeAndRecordedWord(' + word_idx.toString() + ')"  >' + word + '</a> '

}

// ########## Function to initialize server ###############
// This is to try to avoid aws lambda cold start 
try {
    fetch(apiMainPathSTS + '/GetAccuracyFromRecordedAudio', {
        method: "post",
        body: JSON.stringify({ "title": '', "base64Audio": '', "language": AILanguage }),
        headers: { "X-Api-Key": STScoreAPIKey }

    });
}
catch { }

const initializeServer = async () => {

    valid_response = false;
    document.getElementById("main_title").innerHTML = 'Initializing server, this may take up to 2 minutes...';
    let number_of_tries = 0;
    let maximum_number_of_tries = 4;

    while (!valid_response) {
        if (number_of_tries > maximum_number_of_tries) {
            serverWorking = false;
            break;
        }

        try {
            await fetch(apiMainPathSTS + '/GetAccuracyFromRecordedAudio', {
                method: "post",
                body: JSON.stringify({ "title": '', "base64Audio": '', "language": AILanguage }),
                headers: { "X-Api-Key": STScoreAPIKey }

            }).then(
                valid_response = true);
            serverIsInitialized = true;
        }
        catch
        {
            number_of_tries += 1;
        }
    }
}

