import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs so the production build also loads from a file:// origin,
  // which is how the Electron desktop shell serves the UI. Absolute "/assets/..."
  // paths would resolve to the drive root there and the app would come up blank.
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
