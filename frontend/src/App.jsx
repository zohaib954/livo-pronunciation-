import { useState, useRef } from 'react'
import axios from 'axios'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001'

const ScoreRing = ({ score }) => {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = score >= 85 ? '#22c55e' : score >= 70 ? '#eab308' : score >= 50 ? '#f97316' : '#ef4444'

  return (
    <div className="score-ring-wrapper">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#2a2a2a" strokeWidth="12" />
        <circle
          cx="70" cy="70" r={radius} fill="none"
          stroke={color} strokeWidth="12"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
          style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
      </svg>
      <div className="score-label">
        <span className="score-number" style={{ color }}>{score}</span>
        <span className="score-sub">/ 100</span>
      </div>
    </div>
  )
}

const WordChip = ({ word, status, issue }) => {
  const [showTooltip, setShowTooltip] = useState(false)
  const colorMap = {
    correct: '#22c55e',
    mispronounced: '#ef4444',
    unclear: '#f97316'
  }
  const color = colorMap[status] || '#888'

  return (
    <span
      className="word-chip"
      style={{ borderColor: color, color: status === 'correct' ? '#ccc' : color }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {word}
      {issue && showTooltip && (
        <span className="tooltip">{issue}</span>
      )}
    </span>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState('upload')
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  // Recording state
  const [recording, setRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [audioBlob, setAudioBlob] = useState(null)
  const [audioURL, setAudioURL] = useState(null)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  const handleFile = (f) => {
    setFile(f)
    setResult(null)
    setError(null)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  const startRecording = async () => {
    setError(null)
    setAudioBlob(null)
    setAudioURL(null)
    setRecordingTime(0)
    setResult(null)
    chunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const url = URL.createObjectURL(blob)
        setAudioBlob(blob)
        setAudioURL(url)
        stream.getTracks().forEach(t => t.stop())
      }

      mediaRecorder.start()
      setRecording(true)

      // Timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 45) {
            stopRecording()
            return prev
          }
          return prev + 1
        })
      }, 1000)

    } catch (err) {
      setError('Microphone access denied. Please allow microphone permission and try again.')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop()
      setRecording(false)
      clearInterval(timerRef.current)
    }
  }

  const analyzeAudio = async (audioFile) => {
    setLoading(true)
    setError(null)
    setResult(null)

    const formData = new FormData()
    formData.append('file', audioFile)

    try {
      const res = await axios.post(`${API_URL}/analyze`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setResult(res.data)
    } catch (err) {
      const msg = err.response?.data?.detail || 'Something went wrong. Please try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyzeUpload = () => {
    if (file) analyzeAudio(file)
  }

  const handleAnalyzeRecording = () => {
    if (audioBlob) {
      const audioFile = new File([audioBlob], 'recording.webm', { type: 'audio/webm' })
      analyzeAudio(audioFile)
    }
  }

  const reset = () => {
    setFile(null)
    setResult(null)
    setError(null)
    setAudioBlob(null)
    setAudioURL(null)
    setRecordingTime(0)
  }

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0')
    const s = (sec % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const timerColor = recordingTime < 30 ? '#ef4444' : recordingTime <= 45 ? '#22c55e' : '#ef4444'

  return (
    <div className="app">
      <header className="header">
        <div className="logo">🎙️ Livo</div>
        <p className="tagline">AI Pronunciation Coach</p>
      </header>

      <main className="main">
        {!result ? (
          <div className="upload-section">
            <h1 className="title">How's your English pronunciation?</h1>
            <p className="subtitle">Record or upload a 30–45 second English speech sample and get instant AI feedback.</p>

            {/* Tabs */}
            <div className="tabs">
              <button
                className={`tab ${activeTab === 'upload' ? 'active' : ''}`}
                onClick={() => { setActiveTab('upload'); reset() }}
              >
                📁 Upload File
              </button>
              <button
                className={`tab ${activeTab === 'record' ? 'active' : ''}`}
                onClick={() => { setActiveTab('record'); reset() }}
              >
                🎙️ Record Live
              </button>
            </div>

            {/* Upload Tab */}
            {activeTab === 'upload' && (
              <>
                <div
                  className={`dropzone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById('fileInput').click()}
                >
                  <input
                    id="fileInput"
                    type="file"
                    accept="audio/*"
                    style={{ display: 'none' }}
                    onChange={(e) => handleFile(e.target.files[0])}
                  />
                  {file ? (
                    <>
                      <div className="file-icon">🎵</div>
                      <p className="file-name">{file.name}</p>
                      <p className="file-hint">Click to change file</p>
                    </>
                  ) : (
                    <>
                      <div className="file-icon">📁</div>
                      <p className="drop-text">Drop your audio file here</p>
                      <p className="file-hint">or click to browse — mp3, wav, m4a, webm</p>
                    </>
                  )}
                </div>

                <div className="constraints">
                  <span>🕐 30–45 seconds</span>
                  <span>🇬🇧 English only</span>
                  <span>🔒 Audio deleted after analysis</span>
                </div>

                {error && <div className="error-box">⚠️ {error}</div>}

                <button
                  className="analyze-btn"
                  onClick={handleAnalyzeUpload}
                  disabled={!file || loading}
                >
                  {loading ? (
                    <span className="loading-text">
                      <span className="spinner" /> Analyzing...
                    </span>
                  ) : 'Analyze Pronunciation'}
                </button>
              </>
            )}

            {/* Record Tab */}
            {activeTab === 'record' && (
              <>
                <div className="record-box">
                  <div className="timer" style={{ color: timerColor }}>
                    {formatTime(recordingTime)}
                  </div>
                  <p className="timer-hint">
                    {recording
                      ? recordingTime < 30
                        ? `Keep speaking... need ${30 - recordingTime}s more`
                        : 'Good! Stop when ready (max 45s)'
                      : audioBlob
                      ? 'Recording complete — review and analyze'
                      : 'Press record and speak clearly in English'}
                  </p>

                  {/* Waveform animation while recording */}
                  {recording && (
                    <div className="waveform">
                      {[...Array(12)].map((_, i) => (
                        <div key={i} className="wave-bar" style={{ animationDelay: `${i * 0.1}s` }} />
                      ))}
                    </div>
                  )}

                  {/* Playback after recording */}
                  {audioURL && !recording && (
                    <audio controls src={audioURL} className="audio-player" />
                  )}

                  <div className="record-controls">
                    {!recording && !audioBlob && (
                      <button className="record-btn" onClick={startRecording}>
                        ⏺ Start Recording
                      </button>
                    )}
                    {recording && (
                      <button className="stop-btn" onClick={stopRecording}>
                        ⏹ Stop Recording
                      </button>
                    )}
                    {audioBlob && !recording && (
                      <button className="record-btn secondary" onClick={() => {
                        setAudioBlob(null)
                        setAudioURL(null)
                        setRecordingTime(0)
                        setError(null)
                      }}>
                        🔄 Re-record
                      </button>
                    )}
                  </div>
                </div>

                <div className="constraints">
                  <span>🕐 30–45 seconds</span>
                  <span>🇬🇧 English only</span>
                  <span>🔒 Audio deleted after analysis</span>
                </div>

                {error && <div className="error-box">⚠️ {error}</div>}

                <button
                  className="analyze-btn"
                  onClick={handleAnalyzeRecording}
                  disabled={!audioBlob || recording || loading}
                >
                  {loading ? (
                    <span className="loading-text">
                      <span className="spinner" /> Analyzing...
                    </span>
                  ) : 'Analyze Pronunciation'}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="result-section">
            <div className="result-header">
              <ScoreRing score={result.overall_score} />
              <div className="result-meta">
                <h2 className="result-title">Pronunciation Score</h2>
                <p className="feedback">{result.feedback}</p>
                <div className="stats">
                  <span>📝 {result.word_count} words</span>
                  <span>⏱️ {result.duration}s</span>
                  <span>✅ {result.words.filter(w => w.status === 'correct').length} correct</span>
                  <span>❌ {result.words.filter(w => w.status === 'mispronounced').length} mispronounced</span>
                </div>
              </div>
            </div>

            <div className="transcript-section">
              <h3>Transcript with Highlights</h3>
              <p className="legend">
                <span style={{ color: '#22c55e' }}>■</span> Correct &nbsp;
                <span style={{ color: '#ef4444' }}>■</span> Mispronounced &nbsp;
                <span style={{ color: '#f97316' }}>■</span> Unclear
              </p>
              <div className="word-grid">
                {result.words.map((w, i) => (
                  <WordChip key={i} word={w.word} status={w.status} issue={w.issue} />
                ))}
              </div>
            </div>

            <div className="issues-section">
              <h3>Specific Issues</h3>
              {result.words.filter(w => w.status !== 'correct').length === 0 ? (
                <p className="no-issues">No issues found — excellent pronunciation!</p>
              ) : (
                <div className="issues-list">
                  {result.words
                    .filter(w => w.status !== 'correct')
                    .map((w, i) => (
                      <div key={i} className={`issue-card ${w.status}`}>
                        <span className="issue-word">"{w.word}"</span>
                        <span className="issue-badge">{w.status}</span>
                        <span className="issue-desc">{w.issue}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <button className="reset-btn" onClick={reset}>
              Analyze Another Recording
            </button>
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Your audio is processed in real-time and never stored. · DPDP Compliant</p>
      </footer>
    </div>
  )
}