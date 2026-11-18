import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { PullToRefresh } from './components/tb/parts'
import './styles/main.css'
import { startAnalytics } from './analytics'

// Before anything draws: the door (?via=) is read from the address the
// visitor arrived with, and the visit is counted. No UI, no waiting.
startAnalytics()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    {/* Once, for every screen: pull down hard from the top to reload. */}
    <PullToRefresh />
  </React.StrictMode>,
)
