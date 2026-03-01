import pandas as pd
import json
import RuleBasedModels
import random


class TextDataset:
    def __init__(self, table: pd.DataFrame):
        self.table = table
        self.number_of_samples = len(table)

    def __getitem__(self, idx: int):
        return [self.table["sentence"].iloc[idx]]

    def __len__(self):
        return self.number_of_samples


# ─── Load all datasets at module import time ────────────────────────────────
SAMPLE_FOLDER = "./databases/"
AVAILABLE_LANGUAGES = ["hi", "mr", "en"]

lambda_database: dict[str, TextDataset] = {}
lambda_ipa_converter: dict[str, "RuleBasedModels.ITextToPhonemModel"] = {}

for _lang in AVAILABLE_LANGUAGES:
    _df = pd.read_csv(SAMPLE_FOLDER + "data_" + _lang + ".csv", delimiter=";")
    lambda_database[_lang] = TextDataset(_df)
    lambda_ipa_converter[_lang] = RuleBasedModels.get_phonem_converter(_lang)


# ─── Helpers ─────────────────────────────────────────────────────────────────
def getSentenceCategory(sentence: str) -> int:
    """Return 1 (easy), 2 (medium), or 3 (hard) based on word count."""
    word_count = len(sentence.split())
    limits = [0, 8, 20, 100_000]
    for cat in range(len(limits) - 1):
        if limits[cat] < word_count <= limits[cat + 1]:
            return cat + 1
    return 3  # fallback


# ─── Lambda handler ──────────────────────────────────────────────────────────
def lambda_handler(event, context):
    body = json.loads(event["body"])
    category = int(body["category"])  # 0 = random, 1 = easy, 2 = medium, 3 = hard
    language = body.get("language", "en")

    if language not in lambda_database:
        return json.dumps({"error": f"Language '{language}' not supported."})

    dataset = lambda_database[language]
    ipa_converter = lambda_ipa_converter[language]

    # Sample with category filter.
    # Use a hard retry limit so we never spin forever (fixes the silent bare-except loop).
    MAX_RETRIES = 200
    current_transcript = None

    for attempt in range(MAX_RETRIES):
        try:
            idx = random.randint(0, len(dataset) - 1)
            candidate = dataset[idx]
            sentence = candidate[0]

            sentence_category = getSentenceCategory(sentence)
            if category == 0 or sentence_category == category:
                current_transcript = candidate
                break
        except Exception as exc:
            # Log the individual failure, keep trying
            print(f"[lambdaGetSample] Attempt {attempt} failed: {exc!r}")

    if current_transcript is None:
        return json.dumps({"error": "Could not find a matching sentence after many retries."})

    current_ipa = ipa_converter.convertToPhonem(current_transcript[0])

    result = {
        "real_transcript": current_transcript,
        "ipa_transcript":  current_ipa,
        "transcript_translation": "",   # translation removed (no longer supported)
    }
    return json.dumps(result)