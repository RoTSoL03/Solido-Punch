import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import HubApp from './HubApp'
import { preventContextMenu } from './browser/contextMenu'
import './styles.css'

document.addEventListener('contextmenu', preventContextMenu)

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <HubApp />
  </StrictMode>,
)
