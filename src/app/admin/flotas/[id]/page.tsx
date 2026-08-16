import { notFound } from 'next/navigation';
import { getFichaCliente } from '@/lib/admin/ficha-cliente';
import { EstadoError } from '../../ui/kit';
import { Ficha360 } from './ficha';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /admin/flotas/[id] — la ficha 360 del cliente. La puerta vive en
 * admin/layout.tsx (requireSuperadmin gatea el árbol entero); el contenido
 * en ficha.tsx (exportado para el preview). Un id que no es UUID o sin
 * tenant detrás es 404; una BASE caída es error CON reintento — "no existe"
 * y "no se pudo leer" son afirmaciones distintas.
 */
export default async function PaginaFicha({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  let ficha;
  try {
    ficha = await getFichaCliente(id);
  } catch {
    return (
      <main className="p-5">
        <EstadoError mensaje="No se pudo leer la ficha del cliente — la base no respondió." />
      </main>
    );
  }
  if (!ficha) notFound();
  return <Ficha360 f={ficha} />;
}
