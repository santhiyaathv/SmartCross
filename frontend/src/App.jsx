
import { useEffect, useRef, useState } from 'react'

import {
  Activity,
  LayoutDashboard,
  Camera,
  MapPin,
  ShieldCheck,
  BarChart3,
  Video,
  Settings,
  Clock,
  AlertTriangle,
  Menu,
  X,
  ChevronRight,
  Footprints,
  CircleHelp,
  RefreshCw,
  Save,
  Timer
} from 'lucide-react'

import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMapEvents
} from 'react-leaflet'

import 'leaflet/dist/leaflet.css'
import './App.css'

const API_URL = 'http://127.0.0.1:8001'

const navigation = [
  { name: 'Dashboard', icon: LayoutDashboard },
  { name: 'Live Monitoring', icon: Camera },
  { name: 'Crossings', icon: MapPin },
  { name: 'Safety Analysis', icon: ShieldCheck },
  { name: 'Map View', icon: MapPin },
  { name: 'Recordings', icon: Video },
  { name: 'Reports', icon: BarChart3 },
  { name: 'Settings', icon: Settings }
]

/* --------------------------------------------------
   COMMON HELPERS
-------------------------------------------------- */

function getValue(object, keys, fallback = 0) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null) {
      return object[key]
    }
  }

  return fallback
}

function getTimeAnalysis(data) {
  const source =
    data?.calculation ??
    data?.time_analysis ??
    data?.analysis ??
    data ??
    {}

  return {
    ...source,
    road_width_m: source.road_width_m ?? 0,
    walking_speed_mps: source.walking_speed_mps ?? 0,
    walking_time_seconds:
      source.walking_time_seconds ??
      source.walking_time ??
      0,
    safety_buffer_seconds: source.safety_buffer_seconds ?? 0,
    required_time_seconds:
      source.required_crossing_time_seconds ??
      source.required_time_seconds ??
      source.required_time ??
      null,
    allocated_signal_seconds:
      source.allocated_signal_time_seconds ??
      source.allocated_signal_seconds ??
      source.allocated_time_seconds ??
      null,
    deficit_seconds:
      source.time_deficit_seconds ??
      source.deficit_seconds ??
      null,
    surplus_seconds:
      source.time_surplus_seconds ??
      source.surplus_seconds ??
      null,
    safety_status:
      source.safety_status ??
      source.status ??
      'UNKNOWN'
  }
}

function getEvents(data) {
  if (Array.isArray(data)) return data

  return (
    data?.events ||
    data?.completed_events ||
    data?.crossing_events ||
    data?.records ||
    []
  )
}

function formatSeconds(value) {
  if (value === null || value === undefined || value === '') {
    return '—'
  }

  const number = Number(value)

  return Number.isFinite(number)
    ? `${number.toFixed(1)} sec`
    : '—'
}

function getSafetyStatus(analysis) {
  const status = String(
    getValue(
      analysis,
      ['safety_status', 'status', 'safety_classification'],
      'AWAITING DATA'
    )
  ).toUpperCase()

  if (status.includes('INSUFFICIENT') || status.includes('DEFICIT')) {
    return 'INSUFFICIENT'
  }

  if (status.includes('SUFFICIENT')) {
    return 'SUFFICIENT'
  }

  return status
}

function getActiveCrossings(analysis) {
  return Array.isArray(analysis?.active_crossings)
    ? analysis.active_crossings
    : []
}

function getActiveCrossingCount(data) {
  if (Array.isArray(data?.active_crossings)) {
    return data.active_crossings.length
  }

  return Number(data?.active_crossings ?? 0)
}

function getCompletedCount(data) {
  return Number(
    getValue(
      data,
      [
        'total_completed_crossings',
        'total_completed',
        'completed_count',
        'completed_crossings'
      ],
      0
    )
  )
}

/* --------------------------------------------------
   COMMON COMPONENTS
-------------------------------------------------- */

function StatusLabel({ status }) {
  return (
    <span className="status-label">
      <span className="status-dot" />
      {status}
    </span>
  )
}

function DataRow({ label, value }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function MetricCard({ title, value, description, icon: Icon }) {
  return (
    <article className="stat-card">
      <div className="stat-icon">
        <Icon size={22} />
      </div>

      <p className="stat-title">{title}</p>
      <h3>{value}</h3>
      <span className="stat-description">{description}</span>
    </article>
  )
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  textAlign: 'left'
}

const cellStyle = {
  padding: '13px 12px',
  borderBottom: '1px solid #cccccc',
  fontSize: '13px'
}

/* --------------------------------------------------
   API DATA
-------------------------------------------------- */

function useSmartCrossData() {
  const [timeAnalysis, setTimeAnalysis] = useState(null)
  const [settings, setSettings] = useState(null)
  const [events, setEvents] = useState([])
  const [summary, setSummary] = useState({})
  const [crossingStatus, setCrossingStatus] = useState({})
  const [backendStatus, setBackendStatus] = useState('Checking')
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)

  async function refreshData() {
    try {
      const responses = await Promise.all([
        fetch(`${API_URL}/time-analysis`),
        fetch(`${API_URL}/crossing-settings`),
        fetch(`${API_URL}/crossing-events`),
        fetch(`${API_URL}/crossing-summary`)
      ])

      if (responses.some(response => !response.ok)) {
        throw new Error('API request failed.')
      }

      const [
        timeData,
        settingsData,
        crossingData,
        summaryData
      ] = await Promise.all(
        responses.map(response => response.json())
      )

      const normalizedAnalysis = getTimeAnalysis(timeData)
      const newSettings = settingsData?.settings || settingsData || {}

      const summaryEvents = getEvents(summaryData)
      const crossingEvents = getEvents(crossingData)

      const completedEvents =
        summaryEvents.length > 0
          ? summaryEvents
          : crossingEvents

      setTimeAnalysis(normalizedAnalysis)
      setSettings(newSettings)
      setEvents(completedEvents)
      setSummary(summaryData || {})
      setCrossingStatus(summaryData || crossingData || {})
      setBackendStatus('Connected')
      setLastUpdated(new Date())
    } catch (error) {
      console.error('SmartCross API error:', error)
      setBackendStatus('Disconnected')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshData()

    const interval = setInterval(refreshData, 3000)

    return () => clearInterval(interval)
  }, [])

  return {
    timeAnalysis,
    settings,
    events,
    summary,
    crossingStatus,
    backendStatus,
    loading,
    lastUpdated,
    refreshData
  }
}

/* --------------------------------------------------
   LIVE MONITORING
-------------------------------------------------- */

function LiveMonitoring() {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const processingRef = useRef(false)

  const [cameraStatus, setCameraStatus] = useState('Not connected')
  const [error, setError] = useState('')
  const [motionCount, setMotionCount] = useState(0)
  const [trackedObjects, setTrackedObjects] = useState([])
  const [pedestrianDetections, setPedestrianDetections] = useState([])
  const [pedestrianCount, setPedestrianCount] = useState(0)
  const [activeTracks, setActiveTracks] = useState(0)
  const [totalRegistered, setTotalRegistered] = useState(0)
  const [totalLost, setTotalLost] = useState(0)
  const [framesProcessed, setFramesProcessed] = useState(0)
  const [processingStatus, setProcessingStatus] = useState('Waiting')
  const [crossingAnalysis, setCrossingAnalysis] = useState({})
  const [timeAnalysis, setTimeAnalysis] = useState({})

  const [frameSize, setFrameSize] = useState({
    width: 640,
    height: 360
  })

  async function startCamera() {
    setError('')

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      })

      streamRef.current = mediaStream

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
        await videoRef.current.play()
      }

      setCameraStatus('Camera connected')
      setProcessingStatus('Connecting to OpenCV')
    } catch (err) {
      setCameraStatus('Connection failed')
      setProcessingStatus('Stopped')
      setError(err.message || 'Unable to connect to camera.')
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setCameraStatus('Not connected')
    setProcessingStatus('Stopped')
    setMotionCount(0)
    setTrackedObjects([])
    setPedestrianDetections([])
    setPedestrianCount(0)
    setActiveTracks(0)
    setTotalRegistered(0)
    setTotalLost(0)
    setFramesProcessed(0)
    setError('')
  }

  useEffect(() => {
    if (cameraStatus !== 'Camera connected') return

    let cancelled = false

    async function analyzeFrame() {
      if (cancelled || processingRef.current) return

      const video = videoRef.current

      if (!video || video.readyState < 2 || !video.videoWidth) {
        return
      }

      processingRef.current = true

      try {
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 640 / video.videoWidth)

        canvas.width = Math.round(video.videoWidth * scale)
        canvas.height = Math.round(video.videoHeight * scale)

        const context = canvas.getContext('2d')

        context.drawImage(
          video,
          0,
          0,
          canvas.width,
          canvas.height
        )

        const blob = await new Promise(resolve => {
          canvas.toBlob(resolve, 'image/jpeg', 0.75)
        })

        if (!blob || cancelled) return

        const formData = new FormData()
        formData.append('file', blob, 'webcam-frame.jpg')

        const response = await fetch(`${API_URL}/analyze-frame`, {
          method: 'POST',
          body: formData
        })

        if (!response.ok) {
          throw new Error(`OpenCV returned HTTP ${response.status}`)
        }

        const result = await response.json()

        if (!cancelled) {
          const tracks = Array.isArray(result.tracked_objects)
            ? result.tracked_objects
            : []

          const pedestrians = Array.isArray(result.pedestrian_detections)
            ? result.pedestrian_detections
            : []

          setMotionCount(
            result.motion_regions_detected ?? 0
          )

          setTrackedObjects(tracks)
          setPedestrianDetections(pedestrians)
          setPedestrianCount(result.pedestrian_count ?? pedestrians.length)

          setActiveTracks(result.active_tracks ?? tracks.length)
          setTotalRegistered(result.total_registered ?? 0)
          setTotalLost(result.total_lost ?? 0)

          setFrameSize({
            width: canvas.width,
            height: canvas.height
          })

          setCrossingAnalysis(result.crossing_summary || {})
          setTimeAnalysis(getTimeAnalysis(result.time_analysis || result))

          setFramesProcessed(previous => previous + 1)
          setProcessingStatus('OpenCV connected')
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setProcessingStatus('Processing error')
          setError(err.message || 'Unable to process camera frame.')
        }
      } finally {
        processingRef.current = false
      }
    }

    const intervalId = setInterval(analyzeFrame, 700)
    analyzeFrame()

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [cameraStatus])

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  const activeCrossingCount = getActiveCrossingCount(crossingAnalysis)

  return (
    <div className="monitoring-page">
      <section className="panel monitoring-info">
        <h2>Live Pedestrian Monitoring</h2>
        <p>Camera feed with OpenCV motion detection and pedestrian identification.</p>

        <div
          className="live-video-container"
          style={{ position: 'relative' }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="live-video"
          />

          {cameraStatus === 'Camera connected' && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none'
              }}
            >
              <svg
                viewBox={`0 0 ${frameSize.width} ${frameSize.height}`}
                preserveAspectRatio="none"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%'
                }}
              >
                {trackedObjects.map(track => (
                  <g key={`track-${track.track_id}`}>
                    <circle
                      cx={track.position.x}
                      cy={track.position.y}
                      r="5"
                      fill="white"
                      stroke="black"
                      strokeWidth="2"
                    />
                    <text
                      x={track.position.x + 8}
                      y={track.position.y - 8}
                      fill="white"
                      stroke="black"
                      strokeWidth="0.7"
                      fontSize="13"
                    >
                      ID: {track.track_id}
                    </text>
                  </g>
                ))}
              </svg>

              {pedestrianDetections.map((person, index) => (
                <div
                  key={`pedestrian-${index}`}
                  style={{
                    position: 'absolute',
                    left: `${(person.x / frameSize.width) * 100}%`,
                    top: `${(person.y / frameSize.height) * 100}%`,
                    width: `${(person.width / frameSize.width) * 100}%`,
                    height: `${(person.height / frameSize.height) * 100}%`,
                    border: '2px solid #00ff88',
                    boxSizing: 'border-box'
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '-22px',
                      left: 0,
                      background: '#00ff88',
                      color: '#000000',
                      padding: '2px 5px',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Pedestrian {index + 1}
                  </span>
                </div>
              ))}
            </div>
          )}

          {cameraStatus !== 'Camera connected' && (
            <div className="video-overlay">
              <Camera size={42} />
              <h3>Camera not connected</h3>
              <p>Start the camera to begin monitoring.</p>
            </div>
          )}
        </div>

        <div className="camera-controls">
          {cameraStatus !== 'Camera connected' ? (
            <button className="primary-button" onClick={startCamera}>
              <Camera size={17} />
              Start Camera
            </button>
          ) : (
            <button className="stop-button" onClick={stopCamera}>
              <X size={17} />
              Stop Camera
            </button>
          )}
        </div>

        {error && <p>{error}</p>}
      </section>

      <section className="panel monitoring-info">
        <h3>Live Motion Analysis</h3>

        <DataRow label="Camera status" value={cameraStatus} />
        <DataRow label="OpenCV connection" value={processingStatus} />
        <DataRow label="Motion regions detected" value={motionCount} />
        <DataRow label="Active tracked objects" value={activeTracks} />
        <DataRow label="Total registered IDs" value={totalRegistered} />
        <DataRow label="Total lost IDs" value={totalLost} />
        <DataRow label="Frames processed" value={framesProcessed} />
        <DataRow label="Detection method" value="Background subtraction (MOG2)" />
        <DataRow label="Tracking method" value="Centroid tracking" />
        <DataRow label="Pedestrian identification" value="Enabled (HOG + SVM)" />
        <DataRow label="Pedestrians detected" value={pedestrianCount} />
      </section>

      <section className="panel monitoring-info">
        <h3>Live Crossing Analysis</h3>

        <DataRow label="Active crossings" value={activeCrossingCount} />
        <DataRow
          label="Completed crossings"
          value={getCompletedCount(crossingAnalysis)}
        />
        <DataRow
          label="Required crossing time"
          value={formatSeconds(timeAnalysis.required_time_seconds)}
        />
        <DataRow
          label="Allocated WALK time"
          value={formatSeconds(timeAnalysis.allocated_signal_seconds)}
        />
      </section>

      <section className="panel monitoring-info">
        <h3>Currently Tracked Objects</h3>

        {trackedObjects.length === 0 ? (
          <p>No active tracked objects.</p>
        ) : (
          trackedObjects.map(track => (
            <div key={track.track_id}>
              <h4>Track ID: {track.track_id}</h4>
              <p>
                Position: {track.position?.x ?? '—'}, {track.position?.y ?? '—'}
              </p>
              <p>History points: {track.history_points ?? 0}</p>
              <p>Missing frames: {track.missing_frames ?? 0}</p>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

/* --------------------------------------------------
   DASHBOARD
-------------------------------------------------- */

function Dashboard({ data, setActivePage }) {
  const analysis = data.timeAnalysis || {}
  const events = data.events || []
  const summary = data.summary || {}
  const crossingStatus = data.crossingStatus || {}

  const activeCount = getActiveCrossingCount(crossingStatus)
  const completedCount = getCompletedCount(summary)

  const durations = events
    .map(event => Number(event.duration_seconds ?? event.duration))
    .filter(value => Number.isFinite(value) && value >= 0)

  const averageTime = durations.length
    ? durations.reduce((sum, value) => sum + value, 0) / durations.length
    : null

  const status = getSafetyStatus(analysis)

  const metrics = [
    {
      title: 'Completed Crossings',
      value: completedCount,
      description: 'Recorded crossing events',
      icon: Footprints
    },
    {
      title: 'Active Crossings',
      value: activeCount,
      description: 'Currently tracked objects',
      icon: Activity
    },
    {
      title: 'Average Crossing Time',
      value: formatSeconds(averageTime),
      description: 'Average recorded track duration',
      icon: Clock
    },
    {
      title: 'Time Deficit',
      value: formatSeconds(analysis.deficit_seconds),
      description: 'Configured signal-time shortfall',
      icon: AlertTriangle
    }
  ]

  return (
    <>
      <section className="welcome-section">
        <h2>Pedestrian Safety Overview</h2>
        <p>Monitor pedestrian activity and crossing-time safety.</p>
      </section>

      <div className="stats-grid">
        {metrics.map(metric => (
          <MetricCard key={metric.title} {...metric} />
        ))}
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <h3>Live Camera Monitoring</h3>
          <p>Connect your webcam to monitor movement.</p>

          <button
            className="primary-button"
            onClick={() => setActivePage('Live Monitoring')}
          >
            Open Live Monitoring
            <ChevronRight size={17} />
          </button>
        </section>

        <section className="panel">
          <h3>Safety Summary</h3>
          <StatusLabel status={status} />

          <p>
            {status === 'INSUFFICIENT'
              ? 'The configured WALK time is shorter than the required crossing time.'
              : 'Current configured crossing-time analysis.'}
          </p>
        </section>
      </div>

      <section className="panel monitoring-info">
        <h3>Crossing-Time Calculation</h3>

        <DataRow label="Road width" value={`${analysis.road_width_m ?? '—'} m`} />
        <DataRow
          label="Walking speed"
          value={`${analysis.walking_speed_mps ?? '—'} m/s`}
        />
        <DataRow
          label="Walking time"
          value={formatSeconds(analysis.walking_time_seconds)}
        />
        <DataRow
          label="Safety buffer"
          value={formatSeconds(analysis.safety_buffer_seconds)}
        />
        <DataRow
          label="Required crossing time"
          value={formatSeconds(analysis.required_time_seconds)}
        />
        <DataRow
          label="Allocated WALK time"
          value={formatSeconds(analysis.allocated_signal_seconds)}
        />
        <DataRow
          label="Time deficit"
          value={formatSeconds(analysis.deficit_seconds)}
        />
        <DataRow
          label="Time surplus"
          value={formatSeconds(analysis.surplus_seconds)}
        />
      </section>

      <section className="panel recent-panel">
        <div className="panel-heading">
          <h3>Recent Crossing Records</h3>

          <button
            className="text-button"
            onClick={() => setActivePage('Crossings')}
          >
            View all
          </button>
        </div>

        {events.length === 0 ? (
          <p>No crossing records available.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={cellStyle}>Track ID</th>
                  <th style={cellStyle}>Duration</th>
                  <th style={cellStyle}>Status</th>
                </tr>
              </thead>

              <tbody>
                {[...events].slice(-5).reverse().map((event, index) => (
                  <tr key={`${event.track_id}-${index}`}>
                    <td style={cellStyle}>{event.track_id ?? '—'}</td>
                    <td style={cellStyle}>
                      {formatSeconds(event.duration_seconds ?? event.duration)}
                    </td>
                    <td style={cellStyle}>{event.status || 'Completed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h3>Backend Connection</h3>
        <DataRow label="Vision service" value={data.backendStatus} />
        <DataRow
          label="Last updated"
          value={data.lastUpdated?.toLocaleTimeString() || 'Waiting'}
        />
      </section>
    </>
  )
}

/* --------------------------------------------------
   CROSSINGS PAGE
-------------------------------------------------- */

function CrossingsPage({ data }) {
  const events = data.events || []
  const activeCrossingCount = getActiveCrossingCount(data.crossingStatus)

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <section className="panel monitoring-info">
        <h3>Active Crossings</h3>

        <DataRow
          label="Currently active tracked objects"
          value={activeCrossingCount}
        />

        <p>
          Active crossing count is based on the backend tracking summary.
        </p>
      </section>

      <section className="panel monitoring-info">
        <h3>Completed Crossing Records</h3>

        <DataRow
          label="Total completed crossings"
          value={getCompletedCount(data.summary)}
        />

        {events.length === 0 ? (
          <p>No completed crossing records.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={cellStyle}>Track ID</th>
                  <th style={cellStyle}>Timestamp</th>
                  <th style={cellStyle}>Duration</th>
                  <th style={cellStyle}>Status</th>
                </tr>
              </thead>

              <tbody>
                {[...events].reverse().map((event, index) => (
                  <tr key={`${event.track_id}-${index}`}>
                    <td style={cellStyle}>{event.track_id ?? '—'}</td>
                    <td style={cellStyle}>
                      {event.timestamp
                        ? new Date(event.timestamp).toLocaleString()
                        : '—'}
                    </td>
                    <td style={cellStyle}>
                      {formatSeconds(event.duration_seconds ?? event.duration)}
                    </td>
                    <td style={cellStyle}>{event.status || 'Completed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/* --------------------------------------------------
   SAFETY ANALYSIS
-------------------------------------------------- */

function SafetyAnalysisPage({ data }) {
  const analysis = data.timeAnalysis || {}

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <section className="panel monitoring-info">
        <h3>Pedestrian Crossing-Time Safety Analysis</h3>

        <StatusLabel status={getSafetyStatus(analysis)} />

        <DataRow label="Road width" value={`${analysis.road_width_m ?? '—'} m`} />
        <DataRow
          label="Walking speed"
          value={`${analysis.walking_speed_mps ?? '—'} m/s`}
        />
        <DataRow
          label="Walking time"
          value={formatSeconds(analysis.walking_time_seconds)}
        />
        <DataRow
          label="Safety buffer"
          value={formatSeconds(analysis.safety_buffer_seconds)}
        />
        <DataRow
          label="Required crossing time"
          value={formatSeconds(analysis.required_time_seconds)}
        />
        <DataRow
          label="Allocated WALK time"
          value={formatSeconds(analysis.allocated_signal_seconds)}
        />
        <DataRow
          label="Time deficit"
          value={formatSeconds(analysis.deficit_seconds)}
        />
        <DataRow
          label="Time surplus"
          value={formatSeconds(analysis.surplus_seconds)}
        />
      </section>

      <section className="panel monitoring-info">
        <h3>Calculation Method</h3>

        <p>Walking time = Road width / Walking speed.</p>

        <p>Required crossing time = Walking time + Safety buffer.</p>

        <p>
          Time deficit = Required crossing time - Allocated WALK time,
          when the required time is greater.
        </p>

        <p>
          These are configured prototype calculations, not a certified
          traffic-engineering assessment.
        </p>
      </section>
    </div>
  )
}

/* --------------------------------------------------
   SETTINGS PAGE
-------------------------------------------------- */

function SettingsPage({ data }) {
  const [form, setForm] = useState({
    road_width_m: 12,
    walking_speed_mps: 1,
    safety_buffer_seconds: 3,
    allocated_signal_seconds: 12
  })

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!data.settings) return

    setForm({
      road_width_m: data.settings.road_width_m ?? 12,
      walking_speed_mps: data.settings.walking_speed_mps ?? 1,
      safety_buffer_seconds: data.settings.safety_buffer_seconds ?? 3,
      allocated_signal_seconds:
        data.settings.allocated_signal_time_seconds ?? 12
    })
  }, [data.settings])

  function updateField(event) {
    setForm(previous => ({
      ...previous,
      [event.target.name]: event.target.value
    }))
  }

  async function saveSettings(event) {
    event.preventDefault()

    setSaving(true)
    setMessage('')
    setError('')

    try {
      const payload = {
        road_width_m: Number(form.road_width_m),
        walking_speed_mps: Number(form.walking_speed_mps),
        safety_buffer_seconds: Number(form.safety_buffer_seconds),
        allocated_signal_time_seconds: Number(form.allocated_signal_seconds)
      }

      const response = await fetch(`${API_URL}/crossing-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.detail || 'Unable to update settings.')
      }

      setMessage('Settings updated successfully.')
      await data.refreshData()
    } catch (err) {
      setError(err.message || 'Unable to save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel monitoring-info">
      <h3>Crossing Configuration</h3>

      <form onSubmit={saveSettings}>
        <div style={{ display: 'grid', gap: '18px', maxWidth: '520px' }}>
          {[
            ['road_width_m', 'Road width (metres)', 1, 100, 0.1],
            ['walking_speed_mps', 'Walking speed (metres/second)', 0.1, 3, 0.1],
            ['safety_buffer_seconds', 'Safety buffer (seconds)', 0, 60, 0.5],
            ['allocated_signal_seconds', 'Allocated WALK time (seconds)', 0, 300, 0.5]
          ].map(([name, label, min, max, step]) => (
            <label
              key={name}
              style={{ display: 'grid', gap: '8px' }}
            >
              {label}

              <input
                type="number"
                name={name}
                min={min}
                max={max}
                step={step}
                value={form[name]}
                onChange={updateField}
                required
              />
            </label>
          ))}

          <button type="submit" className="primary-button" disabled={saving}>
            <Save size={17} />
            {saving ? 'Saving...' : 'Save Crossing Settings'}
          </button>
        </div>
      </form>

      {message && <p>{message}</p>}
      {error && <p>{error}</p>}
    </section>
  )
}

/* --------------------------------------------------
   REPORTS PAGE
-------------------------------------------------- */

function ReportsPage({ data }) {
  const events = data.events || []
  const analysis = data.timeAnalysis || {}

  const durations = events
    .map(event => Number(event.duration_seconds ?? event.duration))
    .filter(value => Number.isFinite(value) && value >= 0)

  const averageDuration = durations.length
    ? durations.reduce((sum, value) => sum + value, 0) / durations.length
    : null

  const longestDuration = durations.length
    ? Math.max(...durations)
    : null

  const shortestDuration = durations.length
    ? Math.min(...durations)
    : null

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <section className="panel monitoring-info">
        <h3>Crossing Activity Report</h3>

        <div className="stats-grid">
          <MetricCard
            title="Total Crossings"
            value={getCompletedCount(data.summary)}
            description="Completed crossing records"
            icon={Footprints}
          />

          <MetricCard
            title="Average Duration"
            value={formatSeconds(averageDuration)}
            description="Average recorded track duration"
            icon={Clock}
          />

          <MetricCard
            title="Longest Duration"
            value={formatSeconds(longestDuration)}
            description="Longest recorded track duration"
            icon={Timer}
          />

          <MetricCard
            title="Shortest Duration"
            value={formatSeconds(shortestDuration)}
            description="Shortest recorded track duration"
            icon={Activity}
          />
        </div>
      </section>

      <section className="panel monitoring-info">
        <h3>Configured Safety Analysis</h3>

        <DataRow
          label="Required crossing time"
          value={formatSeconds(analysis.required_time_seconds)}
        />

        <DataRow
          label="Allocated WALK time"
          value={formatSeconds(analysis.allocated_signal_seconds)}
        />

        <DataRow
          label="Configured time deficit"
          value={formatSeconds(analysis.deficit_seconds)}
        />

        <DataRow
          label="Safety status"
          value={getSafetyStatus(analysis)}
        />
      </section>

      <section className="panel monitoring-info">
        <h3>Report Records</h3>

        {events.length === 0 ? (
          <p>No crossing records available.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={cellStyle}>Track ID</th>
                  <th style={cellStyle}>Timestamp</th>
                  <th style={cellStyle}>Duration</th>
                  <th style={cellStyle}>Status</th>
                </tr>
              </thead>

              <tbody>
                {[...events].reverse().map((event, index) => (
                  <tr key={`${event.track_id}-${index}`}>
                    <td style={cellStyle}>{event.track_id ?? '—'}</td>
                    <td style={cellStyle}>
                      {event.timestamp
                        ? new Date(event.timestamp).toLocaleString()
                        : '—'}
                    </td>
                    <td style={cellStyle}>
                      {formatSeconds(event.duration_seconds ?? event.duration)}
                    </td>
                    <td style={cellStyle}>{event.status || 'Completed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel monitoring-info">
        <h3>Measurement Note</h3>

        <p>
          Recorded durations are experimental tracking durations.
          They are not independently verified full-road pedestrian
          crossing times. The configured time deficit is calculated
          separately using road width, walking speed, safety buffer
          and allocated WALK time.
        </p>
      </section>
    </div>
  )
}

/* --------------------------------------------------
   MAP VIEW
-------------------------------------------------- */

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(event) {
      onMapClick(event.latlng)
    }
  })

  return null
}

function MapView({ data }) {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const analysis = data.timeAnalysis || {}
  const safetyStatus = getSafetyStatus(analysis)

  async function loadLocations() {
    try {
      const response = await fetch(`${API_URL}/locations`)

      if (!response.ok) {
        throw new Error('Unable to load saved locations.')
      }

      const result = await response.json()

      setLocations(
        Array.isArray(result)
          ? result
          : Array.isArray(result.locations)
            ? result.locations
            : []
      )

      setError('')
    } catch (err) {
      setError(err.message || 'Unable to connect to location storage.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLocations()
  }, [])

  async function addLocation(position) {
    if (saving) return

    const name = window.prompt('Enter crossing location name:')

    if (name === null || !name.trim()) {
      return
    }

    setSaving(true)
    setError('')
    setMessage('')

    try {
      const response = await fetch(`${API_URL}/locations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: name.trim(),
          latitude: Number(position.lat.toFixed(6)),
          longitude: Number(position.lng.toFixed(6))
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.detail || 'Unable to save location.')
      }

      await loadLocations()
      setMessage('Crossing location saved successfully.')
    } catch (err) {
      setError(err.message || 'Unable to save location.')
    } finally {
      setSaving(false)
    }
  }

  async function removeLocation(locationId) {
    const confirmed = window.confirm(
      'Are you sure you want to delete this crossing location?'
    )

    if (!confirmed) return

    setError('')
    setMessage('')

    try {
      const response = await fetch(
        `${API_URL}/locations/${encodeURIComponent(locationId)}`,
        {
          method: 'DELETE'
        }
      )

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.detail || 'Unable to delete location.')
      }

      setLocations(previous =>
        previous.filter(location => location.id !== locationId)
      )

      setMessage('Crossing location deleted successfully.')
    } catch (err) {
      setError(err.message || 'Unable to delete location.')
    }
  }

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <section className="panel monitoring-info">
        <h3>Chennai Pedestrian Crossing Map</h3>

        <p>Default location: Chennai, Tamil Nadu, India.</p>
        <p>Click anywhere on the map to register a crossing location.</p>

        {loading && <p>Loading saved locations...</p>}
        {saving && <p>Saving crossing location...</p>}
        {error && <p>{error}</p>}
        {message && <p>{message}</p>}

        <div
          style={{
            width: '100%',
            height: '500px',
            marginTop: '18px',
            border: '1px solid #999999'
          }}
        >
          <MapContainer
            center={[13.0827, 80.2707]}
            zoom={12}
            scrollWheelZoom={true}
            style={{
              height: '100%',
              width: '100%'
            }}
          >
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapClickHandler onMapClick={addLocation} />

            {locations.map(location => (
              <CircleMarker
                key={location.id}
                center={[
                  location.latitude,
                  location.longitude
                ]}
                radius={8}
                pathOptions={{
                  color: '#333333',
                  fillColor: '#777777',
                  fillOpacity: 0.8
                }}
              >
                <Popup>
                  <div>
                    <strong>{location.name}</strong>

                    <p>Latitude: {location.latitude}</p>
                    <p>Longitude: {location.longitude}</p>
                    <p>Safety status: {safetyStatus}</p>

                    <button
                      onClick={() => removeLocation(location.id)}
                    >
                      Remove location
                    </button>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </section>

      <section className="panel monitoring-info">
        <h3>Crossing Location Details</h3>

        <DataRow label="Total locations" value={locations.length} />
        <DataRow label="Default city" value="Chennai" />
        <DataRow label="Current safety status" value={safetyStatus} />
        <DataRow
          label="Configured time deficit"
          value={formatSeconds(analysis.deficit_seconds)}
        />
        <DataRow
          label="Location storage"
          value="Python backend JSON storage"
        />
      </section>

      <section className="panel monitoring-info">
        <h3>Registered Crossing Locations</h3>

        {loading ? (
          <p>Loading locations...</p>
        ) : locations.length === 0 ? (
          <p>No crossing locations have been registered.</p>
        ) : (
          locations.map(location => (
            <div
              key={location.id}
              style={{
                padding: '14px 0',
                borderBottom: '1px solid #cccccc'
              }}
            >
              <strong>{location.name}</strong>

              <p>Latitude: {location.latitude}</p>
              <p>Longitude: {location.longitude}</p>

              <button
                onClick={() => removeLocation(location.id)}
              >
                Delete location
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

/* --------------------------------------------------
   MAIN APP
-------------------------------------------------- */

function App() {
  const [activePage, setActivePage] = useState('Dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const data = useSmartCrossData()

  return (
    <div className="app-layout">
      {sidebarOpen && (
        <div
          className="mobile-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-icon">
            <Activity size={25} />
          </div>

          <div className="brand-text">
            <h2>SmartCross</h2>
            <span>Pedestrian Safety System</span>
          </div>

          <button
            className="close-sidebar"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        <div className="nav-label">MAIN MENU</div>

        <nav className="navigation">
          {navigation.map(item => {
            const Icon = item.icon

            return (
              <button
                key={item.name}
                className={`nav-item ${
                  activePage === item.name ? 'active' : ''
                }`}
                onClick={() => {
                  setActivePage(item.name)
                  setSidebarOpen(false)
                }}
              >
                <Icon size={19} />
                <span>{item.name}</span>

                {activePage === item.name && (
                  <ChevronRight size={16} className="nav-arrow" />
                )}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="system-card">
            <div className="system-status">
              <span className="status-dot" />
              {data.backendStatus}
            </div>

            <p>SmartCross version 0.2.0</p>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="menu-button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>

            <div>
              <h1>{activePage}</h1>
              <p>Smart City Pedestrian Safety Platform</p>
            </div>
          </div>

          <div className="topbar-right">
            <span>{data.backendStatus}</span>

            <button
              className="notification-button"
              onClick={data.refreshData}
              title="Refresh data"
            >
              <RefreshCw size={19} />
            </button>

            <div className="profile-avatar">SC</div>
          </div>
        </header>

        <section className="page-content">
          {activePage === 'Dashboard' ? (
            <Dashboard
              data={data}
              setActivePage={setActivePage}
            />
          ) : activePage === 'Live Monitoring' ? (
            <LiveMonitoring />
          ) : activePage === 'Crossings' ? (
            <CrossingsPage data={data} />
          ) : activePage === 'Safety Analysis' ? (
            <SafetyAnalysisPage data={data} />
          ) : activePage === 'Map View' ? (
            <MapView data={data} />
          ) : activePage === 'Reports' ? (
            <ReportsPage data={data} />
          ) : activePage === 'Settings' ? (
            <SettingsPage data={data} />
          ) : (
            <section className="panel page-placeholder">
              <div className="placeholder-icon">
                <CircleHelp size={34} />
              </div>

              <h2>{activePage}</h2>

              <p>
                This module will be connected in an upcoming development stage.
              </p>

              <button
                className="primary-button"
                onClick={() => setActivePage('Dashboard')}
              >
                Return to Dashboard
              </button>
            </section>
          )}

          <footer className="footer">
            SmartCross © 2026 · Pedestrian Safety Monitoring Prototype
          </footer>
        </section>
      </main>
    </div>
  )
}

export default App
