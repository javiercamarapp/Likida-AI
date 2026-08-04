import { StatusPill } from '../../admin/ui/kit';
import { mxn } from '@/lib/utils';
import type { Plan } from '@/lib/saas/suscripcion';

// ═══════════════════════════════════════════════════════════════════════════
// Los bloques visuales de Plan & Facturación, separados de la página.
//
// No es arquitectura por gusto, es el mismo motivo que `despacho/vista.tsx`: la
// página es un Server Component que empieza por `resolverTenantEfectivo`, así
// que NO se puede renderizar sin sesión — y CLAUDE.md pide mirar el render, no
// solo medirlo. Con los bloques aquí, el preview temporal importa EL MISMO
// componente que ve el cliente en vez de una copia con los mismos estilos, que
// solo se verificaría a sí misma.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Uso contra el límite del plan.
 *
 * `null` es SIN LÍMITE y se dice con palabras. Pintarlo como una barra al 0%
 * haría ver un plan ilimitado como uno vacío.
 */
export function Uso({ etiqueta, usado, limite }: { etiqueta: string; usado: number; limite: number | null }) {
  const pct = limite === null ? null : Math.min(100, Math.round((usado / limite) * 100));
  return (
    <div className="card p-4">
      <div className="text-lg font-semibold tabular">
        {usado}
        {limite !== null && <span className="text-sm font-normal" style={{ color: 'var(--muted)' }}> / {limite}</span>}
      </div>
      <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{etiqueta}</div>
      {pct === null ? (
        <div className="text-xs mt-2" style={{ color: 'var(--muted)' }}>Sin límite en este plan</div>
      ) : (
        <div className="h-1.5 rounded-full overflow-hidden mt-2" style={{ background: 'var(--canvas)' }}>
          <div className="h-full rounded-full"
            style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--bad)' : 'var(--marca)' }} />
        </div>
      )}
    </div>
  );
}

/**
 * La tarjeta de un plan.
 *
 * TRES ESTADOS QUE SE VEN DISTINTO A PROPÓSITO:
 *  · sin `precioMensual` → "Sin precio configurado", nunca un $0.00 que se
 *    leería como gratis.
 *  · sin `stripePriceId` → se dice que no se puede contratar en línea, en vez
 *    de ofrecer un botón que reventaría al hacer clic.
 *  · el plan actual → se marca y no se ofrece contratar de nuevo.
 *
 * El botón lo pone la página (necesita el server action); aquí va como
 * `children` para que el preview pueda pintar la tarjeta sin uno.
 */
export function TarjetaPlan({
  plan, esActual, children,
}: {
  plan: Plan;
  esActual: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{plan.nombre}</span>
        {esActual && <StatusPill estado="ok">Tu plan</StatusPill>}
      </div>
      <div className="text-2xl font-semibold tabular">
        {plan.precioMensual === null
          ? <span className="text-sm font-normal" style={{ color: 'var(--muted)' }}>Sin precio configurado</span>
          : <>{mxn(plan.precioMensual)}<span className="text-xs font-normal" style={{ color: 'var(--muted)' }}> /mes</span></>}
      </div>
      <ul className="text-xs list-none p-0 m-0 flex flex-col gap-1" style={{ color: 'var(--muted)' }}>
        <li>{plan.limiteViajesMes === null ? 'Viajes sin límite' : `Hasta ${plan.limiteViajesMes} viajes al mes`}</li>
        <li>{plan.limiteOperadores === null ? 'Operadores sin límite' : `Hasta ${plan.limiteOperadores} operadores`}</li>
      </ul>
      {!plan.stripePriceId ? (
        <p className="text-xs mt-auto pt-2" style={{ color: 'var(--muted)' }}>
          Todavía no se puede contratar en línea.
        </p>
      ) : (
        <div className="mt-auto pt-2">{children}</div>
      )}
    </div>
  );
}
