import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { CamposSistema, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import { Bullet } from '@/app/ui-v2/graficas';
import './suscripcion.css';
import { mxn } from '@/lib/utils';
import type { Plan } from '@/lib/saas/suscripcion';
import { etiquetaIva } from '@/lib/saas/iva';

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
export function Uso({ etiqueta, usado, limite, tr = trEs }: { etiqueta: string; usado: number; limite: number | null; tr?: Tr }) {
  return (
    <div className="rv-sus__uso">
      <div className="rv-sus__uso-cifra">
        {usado}
        {limite !== null && <span className="rv-sus__tenue"> / {limite}</span>}
      </div>
      <div className="rv-sus__tenue">{etiqueta}</div>
      {limite === null ? (
        <div className="rv-sus__tenue">{tr('suscripcion.vista.sinLimiteEnEste')}</div>
      ) : (
        <Bullet etiqueta={etiqueta} valor={usado} maximo={Math.max(limite, usado)} meta={limite} />
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
 * EL PRECIO NUNCA VA SOLO: al lado va si INCLUYE IVA o si el IVA va encima.
 * "$10,000/mes" a secas son $10,000 o $11,600 en la cuenta del cliente, y esos
 * $1,600 los descubría al conciliar. Cuando nadie lo declaró se dice eso mismo
 * ("IVA sin declarar") en vez de callarlo — y el cobro está bloqueado detrás.
 * Ver `lib/saas/iva.ts`.
 *
 * El botón lo pone la página (necesita el server action); aquí va como
 * `children` para que el preview pueda pintar la tarjeta sin uno.
 */
export function TarjetaPlan({
  plan, esActual, children, tr = trEs,
}: {
  plan: Plan;
  esActual: boolean;
  children?: React.ReactNode; tr?: Tr;
}) {
  return (
    <Tarjeta titulo={plan.nombre} acciones={esActual ? <StatusChip tono="ok">{tr('suscripcion.vista.tuPlan')}</StatusChip> : undefined}>
      <div className="rv-sus__plan">
        <div className="rv-sus__precio">
          {plan.precioMensual === null
            ? <span className="rv-sus__tenue">{tr('suscripcion.vista.sinPrecioConfigurado')}</span>
            : <>{mxn(plan.precioMensual)}<span className="rv-sus__tenue"> {tr('suscripcion.vista.alMes')} {etiquetaIva(plan.precioIvaIncluido)}</span></>}
        </div>
        <ul className="rv-sus__limites">
          <li>{plan.limiteViajesMes === null ? tr('suscripcion.vista.viajesSinLimite') : tr('suscripcion.vista.hastaViajesAlMes', { limiteViajesMes: plan.limiteViajesMes })}</li>
          <li>{plan.limiteOperadores === null ? tr('suscripcion.vista.operadoresSinLimite') : tr('suscripcion.vista.hastaOperadores', { limiteOperadores: plan.limiteOperadores })}</li>
        </ul>
        {!plan.stripePriceId ? (
          <p className="rv-sus__tenue">{tr('suscripcion.vista.todaviaNoSePuede')}</p>
        ) : (
          <div>{children}</div>
        )}
      </div>
    </Tarjeta>
  );
}

/**
 * A dónde y cómo transfiere la flota.
 *
 * LA REFERENCIA ES LO MÁS IMPORTANTE DE ESTE BLOQUE y por eso va destacada: es
 * lo único que permite casar el depósito con esta factura. Sin ella llegan
 * transferencias de "TRANSPORTES ..." sin saber de qué mes son, y alguien tiene
 * que adivinar o hablarle al cliente.
 *
 * La CLABE se enseña COMPLETA a propósito, aunque el resto del sistema la trate
 * como dato sensible: el cliente la necesita entera para poder transferir. Lo
 * que no puede pasar es que viva en el código de un repo público.
 */
export function InstruccionesTransferencia({
  beneficiario, banco, clabe, monto, subtotal, iva, moneda, referencia, tr = trEs,
}: {
  beneficiario: string;
  banco: string;
  clabe: string;
  /** EL TOTAL, con IVA: es lo que se transfiere. */
  monto: number;
  /** Base sin IVA. `null` = la factura no trae desglose guardado. */
  subtotal?: number | null;
  iva?: number | null;
  moneda: string;
  referencia: string; tr?: Tr;
}) {
  const filas: Array<[string, string, boolean?]> = [
    ['Beneficiario', beneficiario],
    ['Banco', banco],
    ['CLABE', clabe, true],
    // "Monto" a secas no dice si el IVA está dentro, y ese es justo el número
    // que el contralor cruza contra el total del CFDI. Se rotula como TOTAL y,
    // cuando hay desglose, se enseña de qué se compone.
    [tr('suscripcion.vista.totalATransferir'), `${mxn(monto)} ${moneda}`],
    ...(subtotal !== null && subtotal !== undefined && iva !== null && iva !== undefined
      ? [[tr('suscripcion.vista.seDesglosaComo'), `${mxn(subtotal)} + ${mxn(iva)} de IVA`] as [string, string]]
      : []),
    [tr('suscripcion.vista.referenciaPonlaEnEl'), referencia, true],
  ];
  return (
    <div className="rv-sus__transf">
      <CamposSistema etiqueta={tr('suscripcion.vista.datosParaLaTransferencia')} campos={filas.map(([k, v, mono]) => ({
        etiqueta: k,
        valor: mono ? <span className="rv-sus__mono">{v}</span> : v,
      }))} />
      <p className="rv-sus__tenue">
        {tr('suscripcion.vista.sinLaReferenciaEn')}
      </p>
    </div>
  );
}
