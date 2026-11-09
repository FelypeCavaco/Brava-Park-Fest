# Página de vendas do Festou

Site estático (HTML, CSS e JS, sem etapa de build) em `public/`.

- Planos: `public/js/site.js` (lista `PLANOS`). Preço e limites são atualizados
  pelo banco (`platform_public_plans`, migração 095) quando ele responde.
- Formulário: grava em Interessados (`platform_lead_submit`, migração 095).
- Configuração (endereço do banco, chave publicável, WhatsApp): `public/js/config.js`.
- 3D do topo: `public/js/hero3d.js` (Three.js 0.169). Animações: GSAP 3.12 + ScrollTrigger.

Publicação: Worker da Cloudflare com assets (`wrangler.jsonc`), diretório raiz `site-festou`.
