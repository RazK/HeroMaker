import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { PullToRefresh } from './components/tb/parts'
import './styles/main.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    {/* Once, for every screen: pull down hard from the top to reload. */}
    <PullToRefresh />
  </React.StrictMode>,
)
