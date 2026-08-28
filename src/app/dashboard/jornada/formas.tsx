'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { TriangleAlert, CheckCircle2, Lock, Plus, Ban } from 'lucide-react';
import { TZ_MX } from '@/lib/formato';
import { ROTULO_PROCEDENCIA, type Asiento, type JornadaCompuesta } from '@/lib/likida/jornada/modelo';
import type { RiesgoDia, PoliticaFlota } from '@/lib/likida/jornada/riesgo';

// ═══════════════════════════════════════════════════════════════════════════
// LAS CORRECCIONES DEL CONTRALOR — y por qué ninguna sobreescribe una hora.
//
// No hay en este archivo un solo formulario que edite un `momento`. Corregir
// una marca son DOS actos, en este orden:
//
//   1. ANULARLA, con un motivo escrito. La marca se queda en el expediente,
//      con quién la anuló y cuándo.
//   2. CAPTURAR la correcta, que queda con procedencia `capturado_contralor`,
//      el correo de quien la capturó y la hora en que lo hizo.
//
// La alternativa —un campo de hora que se guarda encima— es más cómoda y
// destruye el documento: un registro laboral que se puede editar sin dejar
// rastro no solo deja de probar lo que dice, prueba que se toca. Y el art. 805
// de la LFT convierte el desaseo de este expediente en una presunción a favor
// de quien demanda.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoAccion = { ok: boolean; mensaje?: string; error?: string };
export type AccionJornada = (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;

const VACIO: ResultadoAccion = { ok: true };

const CAMPO = 'w-full hairline rounded-lg px-3 h-9 text-[13px] outline-none focus:border-[var(--muted)] transition-colors';
const ETIQUETA = 'block text-[11px] font-medium mb-1.5';

function Boton({ texto, cargando, icono }: { texto: string; cargando: string; icono?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      {icono}
      {pending ? cargando : texto}
    </button>
  );
}

/** El aviso del resultado. El error sale VERBATIM: está escrito para leerse
 *  aquí y es lo único que dice QUÉ corregir. */
function Aviso({ estado }: { estado: ResultadoAccion }) {
  if (estado.ok && !estado.mensaje) return null;
  return estado.ok ? (
    <div className="flex items-center gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
      style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
      <CheckCircle2 width={15} height={15} strokeWidth={1.75} />
      {estado.mensaje}
    </div>
  ) : (
    <div className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
      style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <TriangleAlert width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      {estado.error}
    </div>
  );
}

function hora(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ_MX,
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

const ROTULO_TIPO: Record<string, string> = {
  inicio_jornada: 'Inicio de jornada',
  fin_jornada: 'Fin de jornada',
  inicio_descanso: 'Inicio de descanso',
  fin_descanso: 'Fin de descanso',
};

export interface FilaAbierta {
  jornadaId: string;
  operadorNombre: string;
  dia: string;
  estado: 'abierto' | 'cerrado';
  cerradoPorEmail: string | null;
  conformeOperadorEn: string | null;
  jornada: JornadaCompuesta;
  riesgo: RiesgoDia;
}

export function FormasJornada({
  fila, puedeCorregir, anularMarca, capturarMarca, cerrarElDia,
}: {
  fila: FilaAbierta;
  puedeCorregir: boolean;
  anularMarca: AccionJornada;
  capturarMarca: AccionJornada;
  cerrarElDia: AccionJornada;
}) {
  // `sueltos` VA EN LA LISTA. Son marcas vivas que no encajaron (un regreso de
  // descanso sin salida, típicamente). Dejarlas fuera las volvería invisibles e
  // imposibles de anular desde aquí: seguirían en la base, fuera del documento
  // que el contralor revisa, y saldrían el día que alguien exporte la tabla
  // cruda en un juicio.
  const vivos = [
    ...(fila.jornada.inicio ? [fila.jornada.inicio] : []),
    ...fila.jornada.descansos.flatMap((d) => [d.inicio, ...(d.fin ? [d.fin] : [])]),
    ...fila.jornada.sueltos,
    ...(fila.jornada.fin ? [fila.jornada.fin] : []),
  ];

  return (
    <section className="card p-4 space-y-4">
      <div>
        <h2 className="font-display text-[15px] font-semibold">
          {fila.operadorNombre} · {fila.dia}
        </h2>
        <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--muted)' }}>
          {fila.estado === 'cerrado'
            ? `Día cerrado por ${fila.cerradoPorEmail ?? 'sin firma'}. Sigue siendo corregible, y la corrección queda anotada.`
            : 'Día abierto.'}
          {' '}
          {fila.conformeOperadorEn
            ? 'El operador confirmó este registro.'
            : 'El operador todavía no lo ha confirmado.'}
        </p>
      </div>

      {/* LO QUE EL MOTOR VIO, CON SU ARTÍCULO. Cada señal trae su fundamento
          para que el contralor pueda ir a leerlo, no para adornar. */}
      {(fila.riesgo.senales.length > 0 || fila.jornada.huecos.length > 0) && (
        <ul className="space-y-1.5 text-[12.5px]">
          {fila.jornada.huecos.map((h) => (
            <li key={h.clase} style={{ color: 'var(--warn)' }}>• {h.dice}</li>
          ))}
          {fila.riesgo.senales.map((s, i) => (
            <li key={`${s.clase}-${i}`} style={{ color: s.esExceso ? 'var(--bad)' : 'var(--muted)' }}>
              • {s.dice}
              {s.fundamento && (
                <span className="block text-[11.5px] pl-3" style={{ color: 'var(--muted)' }}>{s.fundamento}</span>
              )}
            </li>
          ))}
          {fila.riesgo.noEvaluado.map((n) => (
            <li key={n} className="text-[11.5px]" style={{ color: 'var(--muted)' }}>• {n}</li>
          ))}
        </ul>
      )}

      <MarcasDelDia
        vivos={vivos}
        anulados={fila.jornada.anulados}
        jornadaId={fila.jornadaId}
        puedeCorregir={puedeCorregir}
        anularMarca={anularMarca}
      />

      {puedeCorregir && (
        <>
          <FormaCaptura
            jornadaId={fila.jornadaId}
            dia={fila.dia}
            anulados={fila.jornada.anulados}
            capturarMarca={capturarMarca}
          />
          {fila.estado === 'abierto' && (
            <FormaCierre jornadaId={fila.jornadaId} cerrarElDia={cerrarElDia} />
          )}
        </>
      )}
    </section>
  );
}

function MarcasDelDia({
  vivos, anulados, jornadaId, puedeCorregir, anularMarca,
}: {
  vivos: Asiento[];
  anulados: Asiento[];
  jornadaId: string;
  puedeCorregir: boolean;
  anularMarca: AccionJornada;
}) {
  const [estado, accion] = useActionState(anularMarca, VACIO);

  return (
    <div className="space-y-2">
      <h3 className="text-[13px] font-medium">Las marcas del día</h3>
      {vivos.length === 0 && (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          No hay ninguna marca viva. Nadie reportó y no hubo de dónde derivarla: eso no son cero horas.
        </p>
      )}
      <Aviso estado={estado} />
      <ul className="space-y-2">
        {vivos.map((a) => (
          <li key={a.id} className="hairline rounded-lg p-3">
            <div className="text-[12.5px]">
              <strong>{ROTULO_TIPO[a.tipo] ?? a.tipo}</strong> · {hora(a.momento)}
              <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>
                {ROTULO_PROCEDENCIA[a.procedencia]}
                {a.registradoPorEmail ? ` · ${a.registradoPorEmail}` : ''}
                {a.nota ? ` · ${a.nota}` : ''}
                {a.corrigeA ? ' · corrige una marca anulada' : ''}
              </span>
            </div>
            {puedeCorregir && (
              <form action={accion} className="flex items-end gap-2 mt-2 flex-wrap">
                <input type="hidden" name="asientoId" value={a.id} />
                <input type="hidden" name="jornadaId" value={jornadaId} />
                <label className="flex-1 min-w-[220px]">
                  <span className={ETIQUETA}>Motivo de la corrección</span>
                  <input name="motivo" className={CAMPO} minLength={5} required
                    placeholder="Por qué esta marca no es correcta" />
                </label>
                <Boton texto="Anular" cargando="Anulando…" icono={<Ban width={14} height={14} strokeWidth={1.75} />} />
              </form>
            )}
          </li>
        ))}
      </ul>

      {/* LAS ANULADAS SE ENSEÑAN. Esconderlas dejaría la pantalla más limpia y
          el expediente incompleto: la historia de las correcciones es parte de
          lo que hace creíble al documento. */}
      {anulados.length > 0 && (
        <details className="text-[12.5px]">
          <summary className="cursor-pointer" style={{ color: 'var(--muted)' }}>
            {anulados.length} marca(s) anulada(s) — siguen en el expediente
          </summary>
          <ul className="mt-2 space-y-1.5">
            {anulados.map((a) => (
              <li key={a.id} style={{ color: 'var(--muted)' }}>
                <s>{ROTULO_TIPO[a.tipo] ?? a.tipo} · {hora(a.momento)}</s>
                <span className="block text-[11.5px]">
                  Anulada por {a.anuladoPorEmail ?? 'sin firma'}
                  {a.anuladoEn ? ` el ${hora(a.anuladoEn)}` : ''} · {a.anuladoMotivo}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FormaCaptura({
  jornadaId, dia, anulados, capturarMarca,
}: {
  jornadaId: string;
  dia: string;
  anulados: Asiento[];
  capturarMarca: AccionJornada;
}) {
  const [estado, accion] = useActionState(capturarMarca, VACIO);

  // Solo se ofrece corregir lo que YA está anulado. Una marca viva no se
  // «corrige»: se anula primero, con su motivo. El orden importa y por eso el
  // selector no puede ofrecer otra cosa.
  const corregibles = anulados;

  return (
    <form action={accion} className="space-y-2">
      <h3 className="text-[13px] font-medium">Capturar una marca</h3>
      <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
        Queda con tu nombre y la hora en que la capturaste. La hora que escribas es la del
        operador, en horario de México.
      </p>
      <Aviso estado={estado} />
      <input type="hidden" name="jornadaId" value={jornadaId} />
      <div className="flex items-end gap-2 flex-wrap">
        <label>
          <span className={ETIQUETA}>Qué</span>
          <select name="tipo" className={CAMPO} defaultValue="inicio_jornada">
            <option value="inicio_jornada">Inicio de jornada</option>
            <option value="fin_jornada">Fin de jornada</option>
            <option value="inicio_descanso">Inicio de descanso</option>
            <option value="fin_descanso">Fin de descanso</option>
          </select>
        </label>
        <label>
          <span className={ETIQUETA}>Cuándo</span>
          <input type="datetime-local" name="momento" required defaultValue={`${dia}T08:00`} className={CAMPO} />
        </label>
        {/* LA OTRA MITAD DE LA CORRECCIÓN. Anular deja el motivo y la firma;
            esto deja el VÍNCULO — `corrige_a` — que dice cuál de las marcas
            anuladas sustituye esta hora. Sin él, el expediente enseña una
            anulada y una nueva sin decir que son la misma marca corregida, y
            reconstruir la historia queda a criterio de quien la lea. */}
        {corregibles.length > 0 && (
          <label className="min-w-[220px]">
            <span className={ETIQUETA}>¿Corrige una marca anulada?</span>
            <select name="corrigeA" className={CAMPO} defaultValue="">
              <option value="">No, es una marca nueva</option>
              {corregibles.map((a) => (
                <option key={a.id} value={a.id}>
                  {ROTULO_TIPO[a.tipo] ?? a.tipo} · {hora(a.momento)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex-1 min-w-[220px]">
          <span className={ETIQUETA}>Nota (de dónde sacaste la hora)</span>
          <input name="nota" className={CAMPO} placeholder="Ej.: me lo dijo por teléfono a las 8:05" />
        </label>
        <Boton texto="Capturar" cargando="Guardando…" icono={<Plus width={14} height={14} strokeWidth={1.75} />} />
      </div>
    </form>
  );
}

function FormaCierre({ jornadaId, cerrarElDia }: { jornadaId: string; cerrarElDia: AccionJornada }) {
  const [estado, accion] = useActionState(cerrarElDia, VACIO);
  return (
    <form action={accion} className="space-y-2">
      <h3 className="text-[13px] font-medium">Cerrar el día</h3>
      <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
        Cerrar es firmar que revisaste este día. No borra ni congela nada: si después hay que
        corregir algo, se puede, y la corrección queda anotada con quién la hizo.
      </p>
      <Aviso estado={estado} />
      <input type="hidden" name="jornadaId" value={jornadaId} />
      <Boton texto="Cerrar el día" cargando="Cerrando…" icono={<Lock width={14} height={14} strokeWidth={1.75} />} />
    </form>
  );
}

export function FormaPolitica({
  politica, declararPolitica,
}: {
  politica: PoliticaFlota | null;
  declararPolitica: AccionJornada;
}) {
  const [estado, accion] = useActionState(declararPolitica, VACIO);
  return (
    <form action={accion} className="space-y-2">
      <Aviso estado={estado} />
      <div className="flex items-end gap-2 flex-wrap">
        <label>
          <span className={ETIQUETA}>Jornada máxima (horas)</span>
          <input name="horasMaxJornada" type="number" step="0.25" min="0.25" max="24"
            defaultValue={politica?.horasMaxJornada ?? ''} className={CAMPO} placeholder="sin declarar" />
        </label>
        <label>
          <span className={ETIQUETA}>Descanso mínimo (minutos)</span>
          <input name="minutosMinDescanso" type="number" step="1" min="0" max="1440"
            defaultValue={politica?.minutosMinDescanso ?? ''} className={CAMPO} placeholder="sin declarar" />
        </label>
        <label>
          <span className={ETIQUETA}>Entre jornadas (horas)</span>
          <input name="horasMinEntreJornadas" type="number" step="0.25" min="0" max="24"
            defaultValue={politica?.horasMinEntreJornadas ?? ''} className={CAMPO} placeholder="sin declarar" />
        </label>
        <label className="flex-1 min-w-[260px]">
          <span className={ETIQUETA}>En qué se fundan (lo transcribimos sin validarlo)</span>
          <input name="fundamento" defaultValue={politica?.fundamento ?? ''} className={CAMPO}
            placeholder="Ej.: cláusula 14 del contrato colectivo" />
        </label>
        <Boton texto="Guardar umbrales" cargando="Guardando…" />
      </div>
    </form>
  );
}
