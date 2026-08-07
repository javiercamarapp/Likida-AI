import { requireOperador } from '@/lib/auth/guard';
import { mxn } from '@/lib/formato';
import { viajeEnCurso, resumenDelViaje, misComprobantes } from '@/lib/likida/chofer';
import { Titulo, Pendiente, Tarjeta, ListaComprobantes, SinViajeParaComprobantes } from '../vista';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// MIS COMPROBANTES — qué llegó y cuál hay que volver a mandar.
//
// Por WhatsApp el chofer recibe un acuse por foto y ya: para saber si le
// faltó una, tendría que subir por la conversación contando. Aquí están todos
// juntos, con el estado de lectura de cada uno.
//
// "Se leyó mal" no es un detalle técnico: es lo único que el chofer todavía
// puede arreglar solo, y solo mientras siga en ruta. Por eso se marca por
// renglón y no en un contador general.
//
// EL TOTAL Y EL CONTEO NO SE SACAN DE ESTA LISTA. Vienen del mismo cálculo que
// el saldo (`estadoDelViaje`), que cuenta TODOS los gastos del viaje; la lista
// está topada. Sumar lo que está en pantalla daría un total distinto al de la
// pantalla anterior en cuanto un viaje pase de 60 comprobantes.
// ═══════════════════════════════════════════════════════════════════════════

export default async function MisComprobantes() {
  const s = await requireOperador('/chofer/comprobantes');

  if (!s.tenantId) {
    return (
      <>
        <Titulo>Mis comprobantes</Titulo>
        <Pendiente>
          Tu cuenta todavía no está ligada a una flota. Pídele a tu oficina que
          complete tu alta.
        </Pendiente>
      </>
    );
  }

  const viaje = await viajeEnCurso(s.tenantId, s.operadorId);
  if (!viaje) return <SinViajeParaComprobantes />;

  const [r, lista] = await Promise.all([
    resumenDelViaje(s.tenantId, viaje),
    misComprobantes(s.tenantId, viaje),
  ]);

  return (
    <>
      <Titulo>Mis comprobantes</Titulo>
      <p className="text-base -mt-1" style={{ color: 'var(--muted)' }}>
        Viaje {viaje.folio ?? 'sin folio'}
      </p>

      {r && (
        <Tarjeta className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-base" style={{ color: 'var(--muted)' }}>Comprobado</div>
            <div className="text-2xl font-semibold tracking-tight tabular mt-0.5">{mxn(r.comprobado)}</div>
          </div>
          <div className="text-right">
            <div className="text-base" style={{ color: 'var(--muted)' }}>
              {r.comprobantes === 1 ? 'Comprobante' : 'Comprobantes'}
            </div>
            <div className="text-2xl font-semibold tracking-tight tabular mt-0.5">{r.comprobantes}</div>
          </div>
        </Tarjeta>
      )}

      {lista.length === 0 ? (
        <Pendiente>
          Todavía no llega ningún comprobante de este viaje. Mándalos por
          WhatsApp y aparecen aquí.
        </Pendiente>
      ) : (
        <>
          <ListaComprobantes comprobantes={lista} />
          {r && r.comprobantes > lista.length && (
            <p className="text-base text-center" style={{ color: 'var(--faint)' }}>
              Se muestran los {lista.length} más recientes de {r.comprobantes}.
            </p>
          )}
        </>
      )}
    </>
  );
}
