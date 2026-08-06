import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const localHttp = mode === 'local-http'
  return {
    base: './',
    plugins: [
      react(),
      ...(!localHttp
        ? [
            basicSsl({
              name: 'Solido Punch local development',
            }),
          ]
        : []),
    ],
    server: {
      host: localHttp ? '127.0.0.1' : '0.0.0.0',
      port: localHttp ? 5174 : 5173,
      strictPort: true,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
