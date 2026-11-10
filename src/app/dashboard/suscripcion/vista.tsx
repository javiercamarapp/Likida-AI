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
export function Uso({ etiqueta, usado, limite }: { etiqueta: string; usado: number; limite: number | null }) {
  return (
    <div className="rv-sus__uso">
      <div className="rv-sus__uso-cifra">
        {usado}
        {limite !== null && <span className="rv-sus__tenue"> / {limite}</span>}
      </div>
      <div className="rv-sus__tenue">{etiqueta}</div>
      {limite === null ? (
        <div className="rv-sus__tenue">Sin límite en este plan</div>
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
  plan, esActual, children,
}: {
  plan: Plan;
  esActual: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Tarjeta titulo={plan.nombre} acciones={esActual ? <StatusChip tono="ok">Tu plan</StatusChip> : undefined}>
      <div className="rv-sus__plan">
        <div className="rv-sus__precio">
          {plan.precioMensual === null
            ? <span className="rv-sus__tenue">Sin precio configurado</span>
            : <>{mxn(plan.precioMensual)}<span className="rv-sus__tenue"> /mes {etiquetaIva(plan.precioIvaIncluido)}</span></>}
        </div>
        <ul className="rv-sus__limites">
          <li>{plan.limiteViajesMes === null ? 'Viajes sin límite' : `Hasta ${plan.limiteViajesMes} viajes al mes`}</li>
          <li>{plan.limiteOperadores === null ? 'Operadores sin límite' : `Hasta ${plan.limiteOperadores} operadores`}</li>
        </ul>
        {!plan.stripePriceId ? (
          <p className="rv-sus__tenue">Todavía no se puede contratar en línea.</p>
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
  beneficiario, banco, clabe, monto, subtotal, iva, moneda, referencia,
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
  referencia: string;
}) {
  const filas: Array<[string, string, boolean?]> = [
    ['Beneficiario', beneficiario],
    ['Banco', banco],
    ['CLABE', clabe, true],
    // "Monto" a secas no dice si el IVA está dentro, y ese es justo el número
    // que el contralor cruza contra el total del CFDI. Se rotula como TOTAL y,
    // cuando hay desglose, se enseña de qué se compone.
    ['Total a transferir', `${mxn(monto)} ${moneda}`],
    ...(subtotal !== null && subtotal !== undefined && iva !== null && iva !== undefined
      ? [['Se desglosa como', `${mxn(subtotal)} + ${mxn(iva)} de IVA`] as [string, string]]
      : []),
    ['Referencia (ponla en el concepto)', referencia, true],
  ];
  return (
    <div className="rv-sus__transf">
      <CamposSistema etiqueta="Datos para la transferencia" campos={filas.map(([k, v, mono]) => ({
        etiqueta: k,
        valor: mono ? <span className="rv-sus__mono">{v}</span> : v,
      }))} />
      <p className="rv-sus__tenue">
        Sin la referencia en el concepto no podemos saber de qué mes es tu pago, y la factura se queda como
        pendiente aunque el dinero ya haya salido de tu cuenta.
      </p>
    </div>
  );
}
