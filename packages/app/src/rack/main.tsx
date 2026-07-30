import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import RackApp from './RackApp.tsx'
import './rack.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RackApp />
  </StrictMode>,
)
