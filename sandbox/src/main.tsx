import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

/**
 * StrictMode is on deliberately, and matters more here than in most apps.
 *
 * It mounts every component twice in development, so effects run, clean up, and
 * run again. Next.js and Create React App both enable it by default, which
 * means nearly every integrator meets that double-mount on their first run.
 * This package spawns workers, opens a microphone and builds an AudioContext in
 * effects, so anything that leaks or races under a remount would break for them
 * and not for us. Testing without it hides exactly the bugs users hit first.
 */
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
