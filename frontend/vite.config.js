import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/line-fake2/', // GitHub Pagesやサブディレクトリへのデプロイ時に必須
})
