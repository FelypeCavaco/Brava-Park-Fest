import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { UnitProvider } from './lib/UnitContext'
import { AuthProvider } from './lib/AuthContext'
import { UndoProvider } from './lib/UndoContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <UnitProvider>
          <UndoProvider>
            <App />
          </UndoProvider>
        </UnitProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
