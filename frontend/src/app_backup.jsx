
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
  Bell,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Menu,
  X,
  ChevronRight,
  Radio,
  Footprints,
  Wifi,
  CircleHelp
} from 'lucide-react'

import './App.css'

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

const stats = [
  {
    title: 'Crossings Monitored',
    value: '0',
    description: 'No crossing events recorded',
    icon: Footprints,
    color: 'blue'
  },
  {
    title: 'Average Crossing Time',
    value: '—',
    description: 'Awaiting measurements',
    icon: Clock,
    color: 'purple'
  },
  {
    title: 'Time Deficits',
    value: '0',
    description: 'No events analysed yet',
    icon: AlertTriangle,
    color: 'orange'
  },
  {
    title: 'Safety Status',
    value: 'Awaiting Data',
    description: 'Monitoring not started',
    icon: ShieldCheck,
    color: 'green'
  }
]

function LiveMonitoring() {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const processingRef = useRef(false)

  const [cameraStatus, setCameraStatus] = useState('Not connected')
  const [error, setError] = useState('')
  const [motionCount, setMotionCount] = useState(0)
  const [detections, setDetections] = useState([])
  const [frameSize, setFrameSize] = useState({ width: 640, height: 360 })
  const [processingStatus, setProcessingStatus] = useState('Waiting')
  const [framesProcessed, setFramesProcessed] = useState(0)

  const API_URL = 'http://127.0.0.1:8000'

  async function startCamera() {
    setError('')
    setMotionCount(0)
    setDetections([])
    setFramesProcessed(0)
    setProcessingStatus('Starting camera')

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is unavailable. Open this application using localhost or HTTPS.')
      setProcessingStatus('Unavailable')
      return
    }

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

      if (err.name === 'NotAllowedError') {
        setError('Camera permission was denied. Allow camera access in your browser settings.')
      } else if (err.name === 'NotFoundError') {
        setError('No webcam was found. Connect a webcam and try again.')
      } else if (err.name === 'NotReadableError') {
        setError('Your camera may already be in use by another application.')
      } else {
        setError(err.message || 'Unable to connect to the camera.')
      }
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
    setDetections([])
    setError('')
  }

  useEffect(() => {
    if (cameraStatus !== 'Camera connected') return

    let cancelled = false

    async function analyzeFrame() {
      if (cancelled || processingRef.current) return

      const video = videoRef.current
      if (!video || video.readyState < 2 || !video.videoWidth) return

      processingRef.current = true

      try {
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 640 / video.videoWidth)
        canvas.width = Math.round(video.videoWidth * scale)
        canvas.height = Math.round(video.videoHeight * scale)

        const context = canvas.getContext('2d')
        context.drawImage(video, 0, 0, canvas.width, canvas.height)

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
          throw new Error(`OpenCV service returned HTTP ${response.status}`)
        }

        const result = await response.json()

        if (!cancelled) {
          setMotionCount(result.motion_count ?? 0)
          setDetections(result.detections || [])
          setFrameSize({
            width: result.frame_width || canvas.width,
            height: result.frame_height || canvas.height
          })
          setFramesProcessed(previous => previous + 1)
          setProcessingStatus('OpenCV connected')
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setProcessingStatus('Processing error')
          setError(
            'Unable to analyze webcam frames. Check that the Python vision service is running. ' +
            (err.message || '')
          )
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
        streamRef.current = null
      }
    }
  }, [])

  return (
    <div className="monitoring-page">
      <div className="monitoring-intro">
        <div>
          <span className="eyebrow">CAMERA CONTROL</span>
          <h2>Live Pedestrian Monitoring</h2>
          <p>Live camera feed with OpenCV motion analysis.</p>
        </div>

        <span className={cameraStatus === 'Camera connected' ? 'camera-connected' : 'offline-label'}>
          <span className="status-dot" />
          {cameraStatus}
        </span>
      </div>

      <section className="panel live-camera-panel">
        <div className="panel-heading">
          <div>
            <h3>Primary Camera</h3>
            <p>Laptop webcam · OpenCV analysis</p>
          </div>
          <Camera size={22} color="#60a5fa" />
        </div>

        <div className="live-video-container" style={{ position: 'relative' }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="live-video"
          />

          {cameraStatus === 'Camera connected' && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
              {detections.map((item, index) => (
                <div
                  key={`${item.x}-${item.y}-${index}`}
                  style={{
                    position: 'absolute',
                    left: `${(item.x / frameSize.width) * 100}%`,
                    top: `${(item.y / frameSize.height) * 100}%`,
                    width: `${(item.width / frameSize.width) * 100}%`,
                    height: `${(item.height / frameSize.height) * 100}%`,
                    border: '2px solid #22c55e',
                    background: 'rgba(34, 197, 94, 0.10)',
                    boxSizing: 'border-box'
                  }}
                >
                  <span style={{
                    position: 'absolute',
                    top: '-22px',
                    left: '-2px',
                    background: '#16a34a',
                    color: 'white',
                    padding: '2px 6px',
                    fontSize: '11px',
                    borderRadius: '3px',
                    whiteSpace: 'nowrap'
                  }}>
                    Motion {index + 1}
                  </span>
                </div>
              ))}
            </div>
          )}

          {cameraStatus !== 'Camera connected' && (
            <div className="video-overlay">
              <Camera size={48} />
              <h3>Camera feed unavailable</h3>
              <p>Start your webcam to begin monitoring.</p>
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

        {error && (
          <div className="camera-error">
            <AlertTriangle size={18} />
            {error}
          </div>
        )}
      </section>

      <section className="panel monitoring-info">
        <h3>Live Motion Analysis</h3>

        <div className="info-row">
          <span>Camera status</span>
          <strong>{cameraStatus}</strong>
        </div>
        <div className="info-row">
          <span>OpenCV connection</span>
          <strong>{processingStatus}</strong>
        </div>
        <div className="info-row">
          <span>Motion regions detected</span>
          <strong>{motionCount}</strong>
        </div>
        <div className="info-row">
          <span>Frames processed</span>
          <strong>{framesProcessed}</strong>
        </div>
        <div className="info-row">
          <span>Detection method</span>
          <strong>Background subtraction</strong>
        </div>
        <div className="info-row">
          <span>Pedestrian identification</span>
          <strong>Not implemented yet</strong>
        </div>
      </section>
    </div>
  )
}

function App() {
  const [activePage, setActivePage] = useState('Dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
                className={`nav-item ${activePage === item.name ? 'active' : ''}`}
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
              Development build
            </div>

            <p>SmartCross version 0.1.0</p>
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

            <span className="environment-label">
              <span className="status-dot" />
              DEVELOPMENT
            </span>

            <button
              className="notification-button"
              aria-label="Notifications"
            >
              <Bell size={20} />
            </button>

            <div className="profile-avatar">SC</div>

          </div>

        </header>

        <section className="page-content">

          {activePage === 'Dashboard' ? (

            <>

              <div className="welcome-section">

                <div>
                  <span className="eyebrow">OVERVIEW</span>

                  <h2>Pedestrian Safety Overview</h2>

                  <p>
                    Monitor pedestrian crossing activity and identify
                    insufficient signal timing.
                  </p>
                </div>

                <div className="date-label">
                  <Activity size={16} />
                  System dashboard
                </div>

              </div>

              <div className="stats-grid">

                {stats.map(stat => {
                  const Icon = stat.icon

                  return (
                    <article className="stat-card" key={stat.title}>

                      <div className={`stat-icon ${stat.color}`}>
                        <Icon size={22} />
                      </div>

                      <p className="stat-title">{stat.title}</p>

                      <h3>{stat.value}</h3>

                      <span className="stat-description">
                        {stat.description}
                      </span>

                    </article>
                  )
                })}

              </div>

              <div className="dashboard-grid">

                <section className="panel camera-panel">

                  <div className="panel-heading">

                    <div>
                      <h3>Live Camera Monitoring</h3>
                      <p>Primary pedestrian monitoring camera</p>
                    </div>

                    <span className="offline-label">
                      <span className="status-dot" />
                      Not connected
                    </span>

                  </div>

                  <div className="camera-placeholder">

                    <div className="camera-placeholder-icon">
                      <Camera size={38} />
                    </div>

                    <h3>Camera monitoring not started</h3>

                    <p>
                      Connect your laptop webcam to begin testing
                      pedestrian movement monitoring.
                    </p>

                    <button
                      className="primary-button"
                      onClick={() => setActivePage('Live Monitoring')}
                    >
                      Open Live Monitoring
                      <ChevronRight size={17} />
                    </button>

                  </div>

                </section>

                <section className="panel safety-panel">

                  <div className="panel-heading">

                    <div>
                      <h3>Safety Summary</h3>
                      <p>Crossing-time analysis</p>
                    </div>

                    <ShieldCheck size={22} color="#60a5fa" />

                  </div>

                  <div className="safety-empty">

                    <div className="safety-icon">
                      <CheckCircle2 size={30} />
                    </div>

                    <h3>Awaiting crossing data</h3>

                    <p>
                      Safety classifications will appear after actual
                      crossing measurements are collected.
                    </p>

                  </div>

                </section>

              </div>

              <section className="panel recent-panel">

                <div className="panel-heading">

                  <div>
                    <h3>Recent Crossing Records</h3>
                    <p>Recorded pedestrian crossing events</p>
                  </div>

                  <button
                    className="text-button"
                    onClick={() => setActivePage('Crossings')}
                  >
                    View all
                    <ChevronRight size={16} />
                  </button>

                </div>

                <div className="empty-records">
                  <Activity size={28} />
                  <p>No crossing events have been recorded yet.</p>
                </div>

              </section>

              <section className="bottom-grid">

                <div className="mini-panel">

                  <div className="mini-icon">
                    <Radio size={20} />
                  </div>

                  <div>
                    <h4>Camera service</h4>
                    <p>Waiting for connection</p>
                  </div>

                  <span className="mini-status">Offline</span>

                </div>

                <div className="mini-panel">

                  <div className="mini-icon">
                    <Wifi size={20} />
                  </div>

                  <div>
                    <h4>Backend connection</h4>
                    <p>Connection test not performed</p>
                  </div>

                  <span className="mini-status">Pending</span>

                </div>

              </section>

            </>

          ) : activePage === 'Live Monitoring' ? (

            <LiveMonitoring />

          ) : (

            <section className="panel page-placeholder">

              <div className="placeholder-icon">
                <CircleHelp size={34} />
              </div>

              <span className="eyebrow">SMARTCROSS MODULE</span>

              <h2>{activePage}</h2>

              <p>
                This module will be implemented and connected to the
                backend in the upcoming development stages.
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
            SmartCross © 2026 · Pedestrian Safety Intelligence
          </footer>

        </section>

      </main>

    </div>
  )
}

export default App
