from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydub import AudioSegment
import tempfile, os, json
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

app = FastAPI(title="Livo Pronunciation API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SYSTEM_PROMPT = """You are a strict but fair English pronunciation coach.

You will receive a transcript with word-level timestamps from a learner's speech recording.

Your job is to analyze pronunciation quality for each word and return a JSON object with exactly this structure:

{
  "overall_score": <integer 0-100>,
  "feedback": "<one sentence overall summary for the learner>",
  "words": [
    {
      "word": "<word string>",
      "start": <start time in seconds, float>,
      "end": <end time in seconds, float>,
      "status": "<correct | mispronounced | unclear>",
      "issue": <null if correct, else short description like "stress on wrong syllable", "vowel sound off", "consonant dropped", "unclear articulation">
    }
  ]
}

Scoring guide:
- 85-100: near-native, very few errors
- 70-84: good, minor issues that don't affect understanding
- 50-69: noticeable errors, understanding affected sometimes
- below 50: significant errors throughout

Rules:
- Return ONLY valid JSON. No markdown. No explanation. No code fences.
- Every word in the transcript must appear in the words array.
- Be specific with issue descriptions, not generic."""


@app.post("/analyze")
async def analyze_audio(file: UploadFile = File(...)):
    contents = await file.read()

    suffix = os.path.splitext(file.filename)[-1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        # --- Duration validation via pydub ---
        try:
            audio = AudioSegment.from_file(tmp_path)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Could not read audio file. Please upload mp3, wav, m4a, or webm."
            )

        duration_sec = len(audio) / 1000.0

        if duration_sec < 28:
            raise HTTPException(
                status_code=400,
                detail=f"Recording too short ({duration_sec:.1f}s). Please record at least 30 seconds."
            )
        if duration_sec > 47:
            raise HTTPException(
                status_code=400,
                detail=f"Recording too long ({duration_sec:.1f}s). Please keep it under 45 seconds."
            )

        # --- Whisper transcription with word timestamps ---
        with open(tmp_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="verbose_json",
                timestamp_granularities=["word"]
            )

        words_data = transcription.words or []
        transcript_text = transcription.text.strip()

        if not transcript_text:
            raise HTTPException(
                status_code=422,
                detail="No speech detected in the recording. Please try again."
            )

        # --- Build GPT-4o prompt ---
        words_list = [
            {"word": w.word, "start": round(w.start, 2), "end": round(w.end, 2)}
            for w in words_data
        ]

        user_message = f"""Transcript: "{transcript_text}"

Word timestamps (from Whisper STT):
{json.dumps(words_list, indent=2)}

Analyze the pronunciation of this English learner's speech."""

        # --- GPT-4o pronunciation analysis ---
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message}
            ],
            temperature=0.2,
            max_tokens=4096
        )

        raw = response.choices[0].message.content.strip()

        # Debug: print raw response to terminal
        print("=== RAW GPT RESPONSE ===")
        print(raw)
        print("========================")

        # Strip markdown fences
        if raw.startswith("```"):
            parts = raw.split("```")
            raw = parts[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        # Strip any trailing fence
        if raw.endswith("```"):
            raw = raw[:-3].strip()

        result = json.loads(raw)

        result["duration"] = round(duration_sec, 1)
        result["word_count"] = len(words_list)
        result["transcript"] = transcript_text

        return result

    except HTTPException:
        raise
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI returned malformed response. Please try again.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.get("/health")
def health():
    return {"status": "ok", "service": "livo-pronunciation-api"}