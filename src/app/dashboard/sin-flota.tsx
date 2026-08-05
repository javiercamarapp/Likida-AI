import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { EstadoVacio } from '../admin/ui/kit';

// ═══════════════════════════════════════════════════════════════════════════
// "NO HAY FLOTA" NO ES LO MISMO QUE "LA FLOTA NO HA LIQUIDADO NADA".
//
// El 4-ago-2026 la base de producción quedó en CERO tenants. `DEMO_TENANT_ID`
// siguió apuntando al uuid de la flota demo —es una variable de entorno, no
// una llave foránea—, así que el panel abrió igual: todas las consultas
// salieron vacías, y las pantallas dijeron lo que dicen cuando un cliente real
// todavía no cierra su primer viaje ("Aún no hay liquidaciones", "$0.00 de IVA
// acreditable"). Ninguna reventó, y eso es lo que lo vuelve peligroso: el
// panel afirmaba algo sobre el negocio de una flota que no existe.
//
// Es la misma regla de CLAUDE.md que `estadoPanel` ya aplica para una consulta
// caída, un escalón antes: una afirmación sobre el negocio del cliente solo se
// puede hacer cuando hay un cliente. Aquí no lo hay, así que se dice qué falta
// —y se dice ARRIBA, antes que los ceros— en vez de rellenar con ceros que
// parecen medición.
//
// Solo lo puede ver un superadmin: `tenantExiste` sale `false` únicamente para
// una sesión sin `app_user.tenant_id`, y para todos los demás roles esa
// columna tiene llave foránea contra `tenant` (app_user_tenant_id_fkey).
// ═══════════════════════════════════════════════════════════════════════════

export function AvisoSinFlota({ tenantId }: { tenantId: string }) {
  return (
    <EstadoVacio icono={<Building2 width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
      <strong>No hay ninguna flota dada de alta.</strong>{' '}
      Este panel apunta a <code className="text-xs">{tenantId}</code> (el uuid de{' '}
      <code className="text-xs">DEMO_TENANT_ID</code>), y esa fila no existe en la tabla{' '}
      <code className="text-xs">tenant</code>. Lo de abajo son ceros de una flota inexistente, no cifras
      de un cliente: sirve para mirar cómo se ve el panel, no para leer un número.{' '}
      <Link href="/admin/flotas" className="underline font-medium">Dar de alta una flota</Link>.
    </EstadoVacio>
  );
}
