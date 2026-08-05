import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { requireOperador } from '@/lib/auth/guard';
import { viajeEnCurso, resumenDelViaje } from '@/lib/cuadra/chofer';
import { Titulo, Pendiente, SaldoEnVivo, SinViajeParaSaldo, TOQUE } from '../vista';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// MI LIQUIDACIÓN EN VIVO — la pantalla que justifica que esto exista.
//
// Hoy el chofer se entera de lo que le falta comprobar CUANDO SE CIERRA el
// viaje: ya no trae los tickets, ya no puede volver por ellos, y la
// conversación con su oficina empieza siendo un reclamo. Es la misma
// información un día antes, y cambia quién resuelve el problema.
//
// El cálculo NO se hace aquí: viene de `estadoDelViaje`, el mismo que contesta
// "¿cuánto llevo?" por WhatsApp. Dos superficies que suman por su cuenta acaban
// dando dos cifras, y el chofer se queda con la que le conviene para reclamar.
// ═══════════════════════════════════════════════════════════════════════════

export default async function MiLiquidacion() {
  const s = await requireOperador('/chofer/liquidacion');

  if (!s.tenantId) {
    return (
      <>
        <Titulo>Mi saldo</Titulo>
        <Pendiente>
          Tu cuenta todavía no está ligada a una flota, así que no hay saldo que
          calcular. Pídele a tu oficina que complete tu alta.
        </Pendiente>
      </>
    );
  }

  const viaje = await viajeEnCurso(s.tenantId, s.operadorId);
  if (!viaje) return <SinViajeParaSaldo />;

  const r = await resumenDelViaje(s.tenantId, viaje);
  if (!r) {
    // El viaje existía hace un instante y ya no. No se pinta un cero: se dice.
    return (
      <>
        <Titulo>Mi saldo</Titulo>
        <Pendiente>No se pudo leer el viaje. Vuelve a cargar la pantalla.</Pendiente>
      </>
    );
  }

  return (
    <>
      <Titulo>Mi saldo</Titulo>
      <p className="text-base -mt-1" style={{ color: 'var(--muted)' }}>
        Viaje {viaje.folio ?? 'sin folio'}
      </p>

      <SaldoEnVivo r={r} />

      <Link
        href="/chofer/comprobantes"
        className="card px-4 flex items-center justify-between gap-3 text-base font-medium"
        style={{ minHeight: TOQUE.principal }}
      >
        Ver mis comprobantes
        <ChevronRight width={20} height={20} strokeWidth={2} style={{ color: 'var(--muted)' }} />
      </Link>
    </>
  );
}
