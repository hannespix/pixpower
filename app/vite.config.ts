import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub-Pages-Deployment unter https://<user>.github.io/pixpower/
export default defineConfig({
  base: '/pixpower/',
  plugins: [react(), tailwindcss()],
})
