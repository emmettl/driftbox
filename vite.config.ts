import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Project sites are served from /<repo>/, so the deploy workflow passes the prefix
  // that actions/configure-pages resolves. Local dev and the root case stay at '/'.
  base: process.env.BASE_PATH ?? '/',
})
