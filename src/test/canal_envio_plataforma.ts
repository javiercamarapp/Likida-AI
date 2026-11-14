import { vi } from 'vitest';

// Líneas de WhatsApp por tenant: por omisión, en las pruebas ningún tenant tiene línea propia (sale por el entorno global, como
// siempre) y el selector no consulta la base. Las pruebas que miden la línea propia (`salida_por_canal.test.ts`) lo desactivan con
// `vi.unmock('@/lib/meta/canal_envio')` y mockean `@/lib/meta/canal` según su contrato.
vi.mock('@/lib/meta/canal_envio', () => ({
  canalDeEnvio: async () => ({ canal: undefined }),
}));
