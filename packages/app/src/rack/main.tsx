import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import RackApp from './RackApp.tsx'
import { registerOffline } from '../offline.ts'
import './rack.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RackApp />
  </StrictMode>,
)

registerOffline()
