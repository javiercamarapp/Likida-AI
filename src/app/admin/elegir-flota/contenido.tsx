import { Building2, FlaskConical, ArrowLeft, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { StatusPill } from '../ui/kit';

// ═══════════════════════════════════════════════════════════════════════════
// EL SELECTOR DE FLOTA — la pantalla que mató al tenant implícito.
//
// Un superadmin que entra a /dashboard sin "ver como" (`?tenant=`/`?vista=`)
// y sin selección previa aterriza AQUÍ en vez de caer a la demo en silencio
// (hallazgo #1 de la auditoría externa). La demo SIGUE existiendo — como
// opción EXPLÍCITA, con su nombre y su naturaleza a la vista, jamás como
// default que nadie pidió.
//
// Server Component puro y separado del gateo (convención inicio-contenido):
// el preview headless lo monta sin sesión para VERIFICAR MIRANDO.
// ═══════════════════════════════════════════════════════════════════════════

export interface FlotaElegible {
  id: string;
  nombre: string;
}

export function ElegirFlotaContenido({
  flotas, demoId, seleccionActual, next, error, errorLista,
  accionElegir, accionQuitar,
}: {
  /** Las flotas reales (la demo NO va aquí — tiene su tarjeta propia). */
  flotas: FlotaElegible[];
  demoId: string;
  /** La selección vigente de la cookie, para marcarla — null sin selección. */
  seleccionActual: string | null;
  /** A dónde volver después de elegir (ya validado por `destinoSeguro`). */
  next: string;
  /** Error del intento anterior (`?error=`): flota inválida o firma caída. */
  error: string | null;
  /** `true` si la LISTA no se pudo leer — se dice, no se enseña vacía. */
  errorLista: boolean;
  accionElegir: (formData: FormData) => Promise<void>;
  accionQuitar: () => Promise<void>;
}) {
  const tarjeta = (f: FlotaElegible, esDemo: boolean) => {
    const activa = seleccionActual === f.id;
    return (
      <form key={f.id} action={accionElegir}>
        <input type="hidden" name="flota" value={esDemo ? 'demo' : f.id} />
        <input type="hidden" name="next" value={next} />
        <button type="submit"
          className="card w-full text-left p-4 flex items-center gap-3 transition-shadow hover:shadow-lg"
          style={esDemo ? { borderStyle: 'dashed' } : undefined}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
            {esDemo
              ? <FlaskConical width={16} height={16} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
              : <Building2 width={16} height={16} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{f.nombre}</div>
            <div className="cifra-mono text-[11px] mt-0.5 truncate" style={{ color: 'var(--faint)' }}>
              {esDemo ? 'datos de demostración — no es un cliente' : f.id}
            </div>
          </div>
          {activa && <StatusPill estado="ok">activa</StatusPill>}
        </button>
      </form>
    );
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-8">
      <Link href="/admin"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium hover:opacity-70 transition-opacity"
        style={{ color: 'var(--muted)' }}>
        <ArrowLeft width={13} height={13} strokeWidth={1.75} /> Volver a la consola
      </Link>

      <h1 className="text-[22px] leading-tight font-semibold tracking-tight mt-4">
        ¿Qué flota quieres ver?
      </h1>
      <p className="text-sm mt-1.5 max-w-lg" style={{ color: 'var(--muted)' }}>
        El panel del cliente siempre apunta a UNA flota elegida — aquí no hay
        default silencioso. La selección dura una jornada y queda en la
        bitácora de auditoría.
      </p>

      {error && (
        <div className="card p-3 mt-5 flex items-center gap-2.5" style={{ borderColor: 'var(--bad)' }}>
          <AlertTriangle width={15} height={15} strokeWidth={1.75} className="shrink-0" style={{ color: 'var(--bad)' }} />
          <p className="text-[13px]">
            {error === 'firma'
              ? 'No se pudo guardar la selección (falta la llave de firma en el ambiente) — revisa la configuración.'
              : 'Esa flota no existe o no se pudo verificar — elige una de la lista.'}
          </p>
        </div>
      )}

      <div className="etiqueta-mono text-[10px] uppercase mt-6 mb-2" style={{ color: 'var(--faint)' }}>
        Flotas de clientes
      </div>
      {errorLista ? (
        <div className="card p-4">
          <p className="text-sm">
            No se pudo leer la lista de flotas ahora mismo — reintenta en un
            momento. La demo de abajo sigue disponible.
          </p>
        </div>
      ) : flotas.length === 0 ? (
        <div className="card p-4">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No hay flotas de clientes dadas de alta todavía.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {flotas.map((f) => tarjeta(f, false))}
        </div>
      )}

      <div className="etiqueta-mono text-[10px] uppercase mt-6 mb-2" style={{ color: 'var(--faint)' }}>
        Demostración
      </div>
      {tarjeta({ id: demoId, nombre: 'Flota Javier Prueba' }, true)}

      {seleccionActual && (
        <form action={accionQuitar} className="mt-6">
          <button type="submit"
            className="text-[12.5px] font-medium px-3.5 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity"
            style={{ color: 'var(--muted)' }}>
            Quitar la selección y volver al modo global
          </button>
        </form>
      )}
    </div>
  );
}
