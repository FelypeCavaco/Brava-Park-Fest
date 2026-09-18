import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        // Libera acesso via link temporário de compartilhamento (cloudflared quick tunnel).
        // TODO: remover esta linha antes de usar o sistema com dados reais.
        allowedHosts: true,
    },
});
