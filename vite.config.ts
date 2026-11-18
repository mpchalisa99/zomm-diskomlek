import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command }) => {
  return {
    plugins: [
      {
        name: 'suppress-vite-hmr-ws-error',
        transform(code, id) {
          if (id.includes('vite/dist/client/client.mjs')) {
            return code
              .replace(
                'transport.connect(createHMRHandler(handleMessage));',
                '/* HMR WebSocket disabled in preview */'
              )
              .replace(
                'setupForwardConsoleHandler(transport, forwardConsole);',
                '/* Forward console disabled in preview */'
              );
          }
          return null;
        },
      },
      react(),
      tailwindcss(),
      ...(command === 'build'
        ? [
            VitePWA({
              registerType: 'autoUpdate',
              includeAssets: [
                'apple-touch-icon.png',
                'pwa-192x192.png',
                'pwa-512x512.png',
                'assets/aistudio/1794622160588-picsay_109de27f.png',
              ],
              manifest: {
                id: '/',
                name: 'TACTICAL VIDCOMM DISKOMLEKAU',
                short_name: 'VIDCOMM',
                description:
                  'Tactical Video Teleconference (VTC) Command & Platoon Communication System DISKOMLEKAU.',
                theme_color: '#0f172a',
                background_color: '#0f172a',
                display: 'standalone',
                orientation: 'any',
                start_url: '/',
                scope: '/',
                icons: [
                  {
                    src: '/pwa-192x192.png',
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any',
                  },
                  {
                    src: '/pwa-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any',
                  },
                ],
              },
              workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
                navigateFallbackDenylist: [/^\/api\//],
              },
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: false,
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
