import { requireSuperadmin } from '@/lib/auth/guard';
import Copiloto from '../copiloto';

export const dynamic = 'force-dynamic';

/**
 * /admin/copiloto — la página del Copiloto del fundador (Fase 2 del
 * blueprint). La puerta es doble a propósito: aquí `requireSuperadmin`
 * (esta página redirige) y otra vez en /api/admin/copiloto (una ruta /api
 * no pasa por el layout y es su propia puerta). El componente es cliente
 * puro sin datos precargados: TODO dato llega por tools del endpoint —
 * no hay cifra que servir desde aquí que el copiloto no deba citar con
 * fuente.
 */
export default async function PaginaCopiloto() {
  await requireSuperadmin();
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <div className="flex-1 flex flex-col"><Copiloto /></div>
      </div>
    </main>
  );
}
