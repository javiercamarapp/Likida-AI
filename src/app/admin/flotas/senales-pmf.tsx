import { Activity, CheckCircle2, Circle, AlertTriangle } from 'lucide-react';
import { numero } from '@/lib/formato';
import { agregarSenalesPmf, type SenalesPmf } from '@/lib/likida/pmf';
import { TituloSeccion } from '../../dashboard/resumen-visual';

// ═══════════════════════════════════════════════════════════════════════════
// LAS 3 SEÑALES DE PMF, POR FLOTA — la vista del lector de lib/likida/pmf.ts.
//
// Vive en /admin/flotas y no en una pantalla propia: con un cliente, un rubro
// nuevo del sidebar sería ceremonia — la pregunta "¿se usa de verdad?" se
// contesta en la MISMA ficha donde Javier ya revisa el onboarding.
//
// Tres estados por señal y los tres se dibujan distinto (mismo criterio que
// las casillas de onboarding): señal PRESENTE (medida y encendida), AÚN NO
// (medida y apagada, o sin datos que medir — y el texto dice cuál de las
// dos), y NO SE PUDO LEER (la consulta falló: ≠ "sin datos").
// ═══════════════════════════════════════════════════════════════════════════

export interface FlotaConSenales {
  id: string;
  nombre: string;
  /** `null` = la lectura de ESA flota falló (la página atrapa por flota). */
  senales: SenalesPmf | null;
}

function Senal({ estado, texto }: { estado: 'presente' | 'aun_no' | 'sin_medir'; texto: string }) {
  const icono = estado === 'presente'
    ? <CheckCircle2 width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--ok)' }} />
    : estado === 'aun_no'
      ? <Circle width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
      : <AlertTriangle width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--warn)' }} />;
  return (
    <div className="flex items-start gap-2 text-sm py-1">
      <span className="mt-0.5 shrink-0">{icono}</span>
      <span className="flex-1 min-w-0" style={estado === 'presente' ? undefined : { color: 'var(--muted)' }}>{texto}</span>
    </div>
  );
}

/** Señal 1 en palabras. El demo se nombra como demo — jamás como uso. */
function textoDescargas(s: SenalesPmf['descargas']): { estado: 'presente' | 'aun_no'; texto: string } {
  if (!s.medida) return { estado: 'aun_no', texto: 'PDF abierto por el cliente: sin liquidaciones todavía — sin datos que medir' };
  if (s.porCliente > 0) {
    return {
      estado: 'presente',
      texto: `${numero(s.porCliente)} de ${numero(s.liquidaciones)} PDFs con primera descarga de un rol del cliente`
        + (s.soloDemo > 0 ? ` (y ${numero(s.soloDemo)} solo en demo)` : ''),
    };
  }
  if (s.soloDemo > 0) {
    return {
      estado: 'aun_no',
      texto: `Solo Javier (superadmin) ha bajado PDFs (${numero(s.soloDemo)} de ${numero(s.liquidaciones)}) — demo, no señal de PMF`,
    };
  }
  return { estado: 'aun_no', texto: `Ningún PDF descargado aún, de ${numero(s.liquidaciones)} generados` };
}

function textoComprobacion(s: SenalesPmf['comprobacionSola']): { estado: 'presente' | 'aun_no'; texto: string } {
  if (!s.medida) return { estado: 'aun_no', texto: 'Comprobación sin recordatorio: sin viajes liquidados todavía — sin datos que medir' };
  if (s.sinRecordatorio > 0) {
    return {
      estado: 'presente',
      texto: `${numero(s.sinRecordatorio)} de ${numero(s.liquidados)} viajes liquidados cerraron sin recordatorio de cobranza`,
    };
  }
  return { estado: 'aun_no', texto: `Los ${numero(s.liquidados)} viajes liquidados necesitaron recordatorio` };
}

function textoTickets(s: SenalesPmf['tickets']): { estado: 'presente' | 'aun_no'; texto: string } {
  if (!s.medida) {
    // A esta escala, cero tickets NO es buena noticia: es ausencia de dato.
    return { estado: 'aun_no', texto: 'Tickets del cliente: ninguno todavía — a esta escala es ausencia de dato, no buena señal' };
  }
  if (s.delCliente > 0) {
    return {
      estado: 'presente',
      texto: `${numero(s.delCliente)} ${s.delCliente === 1 ? 'ticket abierto' : 'tickets abiertos'} por el cliente`
        + (s.deLikida > 0 ? ` (más ${numero(s.deLikida)} de Likida)` : ''),
    };
  }
  return { estado: 'aun_no', texto: `Solo Likida ha abierto tickets (${numero(s.deLikida)}) — el cliente aún no se queja por su cuenta` };
}

export function SenalesPmfPorFlota({ flotas }: { flotas: FlotaConSenales[] }) {
  const medidas = flotas.map((f) => f.senales).filter((s): s is SenalesPmf => s !== null);
  const agregado = flotas.length > 1 && medidas.length > 1 ? agregarSenalesPmf(medidas) : null;

  return (
    <section className="card p-4">
      <div className="flex items-center gap-2">
        <Activity width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
        <TituloSeccion>Señales de PMF por flota — ¿se usa de verdad?</TituloSeccion>
      </div>
      {agregado !== null && agregado.descargas.medida && (
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          En conjunto: {numero(agregado.descargas.porCliente)} de {numero(agregado.descargas.liquidaciones)} PDFs
          con primera descarga de un rol del cliente.
        </p>
      )}
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-2">
        {flotas.map((f) => (
          <div key={f.id} className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
            <div className="text-[13px] font-medium mb-1">{f.nombre}</div>
            {f.senales === null ? (
              <Senal estado="sin_medir" texto="No se pudieron leer las señales de esta flota (≠ que falten) — reintenta recargando" />
            ) : (
              <>
                <Senal {...textoDescargas(f.senales.descargas)} />
                <Senal {...textoComprobacion(f.senales.comprobacionSola)} />
                <Senal {...textoTickets(f.senales.tickets)} />
              </>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
        Las tres señales que dicen si el producto se usa, no solo si se firmó: el PDF abierto por un rol
        del cliente (mig. 0114 — una primera descarga de superadmin es demo y se nombra como demo), viajes
        liquidados sin recordatorio de cobranza, y tickets abiertos por el cliente. «Sin datos» es que no
        hay qué medir; «no se pudo leer» es que la consulta falló.
      </p>
    </section>
  );
}
