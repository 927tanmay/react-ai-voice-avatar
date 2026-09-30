import React from 'react'
import ReactDOM from 'react-dom/client'
import { VoicePage } from './VoicePage'

/**
 * The voice-only page, as its own entry rather than a route in the homepage.
 *
 * A route would share the homepage's bundle, and with it three.js and the
 * avatar. As a separate entry this page's module graph holds React and the
 * headless hook and nothing else, so a visitor sent here gets a page that
 * opens at once and never downloads an avatar. StrictMode stays on for the
 * reason given in ../main.tsx.
 */
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <VoicePage />
  </React.StrictMode>,
)
