import { vi } from 'vitest';

// F20: por omisión, en las pruebas el plan de TODA flota deja salir (si no, cada prueba que ejercita un envío real contra
// supabase simulado fallaría cerrado, que es justo lo que el código de producción hace). Las pruebas que miden el freno
// (`salidas_flota*.test.ts`, `*_plan_pausado.test.ts`) lo desactivan con `vi.unmock('@/lib/saas/salidas_flota')`.
vi.mock('@/lib/saas/salidas_flota', async (importar) => ({
  ...(await importar<typeof import('@/lib/saas/salidas_flota')>()),
  veredictoSalidasDeFlota: async () => ({ salen: true, estado: 'libre' }),
  veredictoSalidasHaciaTelefono: async () => ({ salen: true, estado: 'libre' }),
  salidasPermitidas: async () => true,
}));
