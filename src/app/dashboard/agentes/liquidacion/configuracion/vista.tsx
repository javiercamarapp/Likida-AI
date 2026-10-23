import Link from 'next/link';
import { Mail, ArrowLeft, Save } from 'lucide-react';
import { BarraPagina } from '../../../resumen-visual';
// SOLO tipos y constantes: el repo importa supabaseAdmin y no debe entrar al bundle de la vista.
import type { ConfigCorreo, CanalEntrega } from '@/lib/likida/liquidacion_externa/repo_correo';

type Accion = (fd: FormData) => Promise<void>;
export interface AccionesConfiguracion { guardar: Accion }

// ── Lectura y validación del formulario (pura; la usa la acción del servidor) ──────────────────────────────────────

export const CANALES: ReadonlyArray<{ valor: CanalEntrega; etiqueta: string }> = [
  { valor: 'correo', etiqueta: 'Correo' },
  { valor: 'ambos', etiqueta: 'Correo y WhatsApp' },
  { valor: 'whatsapp', etiqueta: 'WhatsApp' },
];
export const TIPOS_OPERADOR: ReadonlyArray<{ valor: string; etiqueta: string }> = [
  { valor: 'foraneo', etiqueta: 'Foráneos' },
  { valor: 'local', etiqueta: 'Locales' },
  { valor: 'permisionario', etiqueta: 'Permisionarios' },
];

/** Misma regla que las CHECK de la migración 0785. */
const FORMA_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_CORREO = 254;
export const MAX_RH = 3;
const MAX_ETIQUETA = 80;
const MAX_CONCEPTOS_VIAJE = 20;
const MAX_RENOMBRES = 50;
const MAX_PROHIBIDOS = 50;

/** Una regla del contralor tal como se guarda en `renombres` (jsonb): texto literal ⇒ etiqueta. Sin regex libre del usuario. */
export interface RenombreGuardado { texto: string; patron: string; flags: 'i'; a: string; fusionar: false }

const escaparRegex = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lineas = (v: FormDataEntryValue | null, separadores: RegExp): string[] =>
  String(v ?? '').split(separadores).map((x) => x.trim()).filter((x) => x !== '');
const unicos = (xs: string[]): string[] => {
  const vistos = new Set<string>();
  return xs.filter((x) => { const k = x.toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; });
};

function esRenombre(x: unknown): x is RenombreGuardado {
  return !!x && typeof x === 'object' && typeof (x as RenombreGuardado).texto === 'string' && typeof (x as RenombreGuardado).a === 'string';
}

export type ResultadoFormulario = { ok: true; config: ConfigCorreo } | { ok: false; error: string };

/**
 * Convierte lo que llega del formulario en una `ConfigCorreo` válida, o dice en lenguaje llano qué corregir.
 * Nada se activa por omisión: «activa» solo es true si la casilla viene marcada.
 */
export function leerFormularioConfig(fd: FormData): ResultadoFormulario {
  const canal = String(fd.get('canal') ?? '');
  if (!CANALES.some((c) => c.valor === canal)) return { ok: false, error: 'Elige cómo se entrega el desglose: correo, correo y WhatsApp, o WhatsApp.' };

  const correo = (campo: string, v: string): string | null => {
    const t = v.trim().toLowerCase();
    if (t === '') return null;
    if (t.length > MAX_CORREO || !FORMA_CORREO.test(t)) throw new Error(`${campo}: el correo no tiene forma de correo (revisa que lleve @ y dominio).`);
    return t;
  };

  try {
    const remitente = String(fd.get('remitenteNombre') ?? '').trim();
    if (remitente.length > MAX_ETIQUETA) return { ok: false, error: `El nombre del remitente es demasiado largo (máximo ${MAX_ETIQUETA} letras).` };

    const rhBruto = unicos(lineas(fd.get('rhCorreos'), /[\n,;]+/));
    if (rhBruto.length > MAX_RH) return { ok: false, error: `Puedes poner hasta ${MAX_RH} correos de RH; pusiste ${rhBruto.length}.` };
    const rhCorreos = rhBruto.map((c) => correo('Correo de RH', c)).filter((c): c is string => c !== null);

    const agruparViaje = fd.get('agruparViaje') === 'on';
    const etiquetaViaje = String(fd.get('etiquetaViaje') ?? '').trim();
    if (agruparViaje && etiquetaViaje === '') return { ok: false, error: 'Activaste el renglón de viaje: ponle una etiqueta (así se verá en el desglose).' };
    if (etiquetaViaje.length > MAX_ETIQUETA) return { ok: false, error: `La etiqueta del viaje es demasiado larga (máximo ${MAX_ETIQUETA} letras).` };
    const conceptosViaje = unicos(lineas(fd.get('conceptosViaje'), /[\n;]+/));
    if (conceptosViaje.length > MAX_CONCEPTOS_VIAJE) return { ok: false, error: `Son demasiados conceptos para el renglón de viaje (máximo ${MAX_CONCEPTOS_VIAJE}).` };
    if (agruparViaje && conceptosViaje.length === 0) return { ok: false, error: 'Activaste el renglón de viaje: indica qué conceptos se funden en él.' };

    const renombres: RenombreGuardado[] = [];
    for (const [i, l] of lineas(fd.get('renombres'), /\n+/).entries()) {
      const partes = l.split(/\s*(?:=>|->|→)\s*/);
      const texto = (partes[0] ?? '').trim();
      const a = (partes[1] ?? '').trim();
      if (partes.length !== 2 || texto === '' || a === '') return { ok: false, error: `Renombre ${i + 1}: escríbelo como «concepto → etiqueta».` };
      if (texto.length > MAX_ETIQUETA || a.length > MAX_ETIQUETA) return { ok: false, error: `Renombre ${i + 1}: el texto es demasiado largo (máximo ${MAX_ETIQUETA} letras).` };
      renombres.push({ texto, patron: escaparRegex(texto), flags: 'i', a, fusionar: false });
    }
    if (renombres.length > MAX_RENOMBRES) return { ok: false, error: `Son demasiados renombres (máximo ${MAX_RENOMBRES}).` };

    const conceptosProhibidos = unicos(lineas(fd.get('conceptosProhibidos'), /[\n;]+/));
    if (conceptosProhibidos.length > MAX_PROHIBIDOS) return { ok: false, error: `Son demasiados conceptos que retienen el envío (máximo ${MAX_PROHIBIDOS}).` };

    const tiposQueReciben = fd.getAll('tiposQueReciben').map(String).filter((t) => TIPOS_OPERADOR.some((x) => x.valor === t));

    const netoNegativo = fd.get('netoNegativo') === 'enviar' ? 'enviar' : 'retener';

    const horaTxt = String(fd.get('enviarDesdeHora') ?? '').trim();
    let enviarDesdeHora: number | null = null;
    if (horaTxt !== '') {
      const h = Number(horaTxt);
      if (!Number.isInteger(h) || h < 0 || h > 23) return { ok: false, error: 'La hora mínima de envío debe ser un número entero de 0 a 23.' };
      enviarDesdeHora = h;
    }

    return {
      ok: true,
      config: {
        canal: canal as CanalEntrega,
        activa: fd.get('activa') === 'on',
        remitenteNombre: remitente || null,
        responderA: correo('Responder a', String(fd.get('responderA') ?? '')),
        rhCorreos,
        archivoCorreo: correo('Buzón de archivo', String(fd.get('archivoCorreo') ?? '')),
        enviaCoordinador: fd.get('enviaCoordinador') === 'on',
        enviaRh: rhCorreos.length > 0,
        etiquetaViaje: etiquetaViaje || 'Pago de viaje',
        agruparViaje,
        conceptosViaje,
        renombres,
        conceptosProhibidos,
        tiposQueReciben,
        netoNegativo,
        enviarDesdeHora,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Revisa los datos del formulario.' };
  }
}

// ── Vista ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const CSS_INPUT = 'hairline text-[12.5px] px-2.5 py-1.5 rounded-lg w-full';
const ESTILO_INPUT = { background: 'var(--surface)', color: 'var(--ink)' } as const;
const CSS_BOTON = 'inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85';
const ESTILO_PRIMARIO = { background: 'var(--marca)', color: 'var(--marca-fg)' } as const;

function Etiqueta({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{t}</span>
      {children}
    </label>
  );
}
const Ayuda = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[11px]" style={{ color: 'var(--faint)' }}>{children}</span>
);

export function VistaConfiguracionLiquidacion({ sufijo, aviso, error, config, hayFila, disponible, puedeAdministrar, acciones }: {
  sufijo: string; aviso: string | null; error: string | null;
  /** Lo guardado, o el defecto (WhatsApp, inactiva) cuando la flota no tiene fila. */
  config: ConfigCorreo;
  hayFila: boolean;
  /** false si la base no tiene las migraciones 0785-0787: la pantalla lo dice en vez de fingir un formulario que no guarda. */
  disponible: boolean;
  puedeAdministrar: boolean; acciones: AccionesConfiguracion;
}) {
  const off = !puedeAdministrar || !disponible;
  const renombres = (Array.isArray(config.renombres) ? config.renombres : []).filter(esRenombre);
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Mail width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Configuración del desglose"
          derecha={
            <Link href={`/dashboard/agentes/liquidacion${sufijo}`} className="inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-70" style={{ color: 'var(--marca)' }}>
              <ArrowLeft width={12} height={12} strokeWidth={2} /> Volver al agente
            </Link>
          }
        />
        <div className="px-5 py-5 flex-1 space-y-4">
          {aviso && <p role="status" className="card p-3 text-[12.5px]" style={{ color: 'var(--ink)' }}>{aviso}</p>}
          {error && <p role="alert" className="card p-3 text-[12.5px]" style={{ color: 'var(--bad)' }}>{error}</p>}

          {!disponible && (
            <p role="alert" className="card p-3 text-[12.5px]" style={{ color: 'var(--bad)' }}>
              La configuración de la entrega por correo todavía no está disponible en esta base. No se puede leer ni guardar nada hasta que se aplique.
            </p>
          )}
          {disponible && !hayFila && (
            <p className="card p-3 text-[12.5px]" style={{ color: 'var(--muted)' }}>
              Todavía no hay configuración guardada: el agente sigue entregando por WhatsApp y no se manda nada por correo. El envío por correo no se activa solo; tú lo enciendes cuando esté todo listo.
            </p>
          )}
          {!puedeAdministrar && (
            <p className="text-[12px]" style={{ color: 'var(--faint)' }}>Solo el dueño de la flota cambia esta configuración.</p>
          )}

          <form action={acciones.guardar} className="space-y-4">
            <section className="card p-4 space-y-3">
              <h2 className="font-display text-[15px] font-semibold">1. Entrega</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <Etiqueta t="Canal">
                  <select name="canal" defaultValue={config.canal} className={CSS_INPUT} style={ESTILO_INPUT} disabled={off}>
                    {CANALES.map((c) => <option key={c.valor} value={c.valor}>{c.etiqueta}</option>)}
                  </select>
                </Etiqueta>
                <Etiqueta t="Envío por correo">
                  <span className="flex items-center gap-2 text-[12.5px]">
                    <input type="checkbox" name="activa" defaultChecked={config.activa} disabled={off} /> Activar el envío
                  </span>
                  <Ayuda>Apagado, no sale ningún correo aunque haya desgloses listos: quedan en espera y salen solos al encenderlo.</Ayuda>
                </Etiqueta>
                <Etiqueta t="Nombre del remitente">
                  <input name="remitenteNombre" defaultValue={config.remitenteNombre ?? ''} maxLength={MAX_ETIQUETA} placeholder="(sin definir)" className={CSS_INPUT} style={ESTILO_INPUT} disabled={off} />
                </Etiqueta>
                <Etiqueta t="Responder a">
                  <input name="responderA" type="email" defaultValue={config.responderA ?? ''} maxLength={MAX_CORREO} placeholder="(sin definir)" className={CSS_INPUT} style={ESTILO_INPUT} disabled={off} />
                </Etiqueta>
                <Etiqueta t="Hora mínima de envío (0 a 23)">
                  <input name="enviarDesdeHora" type="number" min={0} max={23} step={1} defaultValue={config.enviarDesdeHora ?? ''} placeholder="(sin restricción)" className={CSS_INPUT} style={ESTILO_INPUT} disabled={off} />
                </Etiqueta>
              </div>
            </section>

            <section className="card p-4 space-y-3">
              <h2 className="font-display text-[15px] font-semibold">2. Quién lo recibe</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <Etiqueta t={`Correos de RH (hasta ${MAX_RH}, uno por renglón)`}>
                  <textarea name="rhCorreos" rows={3} defaultValue={config.rhCorreos.join('\n')} placeholder="(vacío: RH no recibe copia)" className={CSS_INPUT} style={ESTILO_INPUT} disabled={off} />
                </Etiqueta>
                <Etiqueta t="Buzón de archivo">
                  <input name="archivoCorreo" type="email" defaultValue={config.archivoCorreo ?? ''} maxLength={MAX_CORREO} placeholder="(sin definir)" className={CSS_INPUT} style={ESTILO_INPUT} disabled={off} />
                  <Ayuda>Recibe una copia de cada desglose para el archivo de la empresa.</Ayuda>
                </Etiqueta>
                <Etiqueta t="Coordinador">
                  <span className="flex items-center gap-2 text-[12.5px]">
                    <input type="checkbox" name="enviaCoordinador" defaultChecked={config.enviaCoordinador} disabled={off} /> Enviar también al coordinador del operador
                  </span>
                </Etiqueta>
                <fieldset className="flex flex-col gap-1" disabled={off}>
                  <legend className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Tipos de operador que reciben su desglose</legend>
                  {TIPOS_OPERADOR.map((t) => (
                    <span key={t.valor} className="flex items-center gap-2 text-[12.5px]">
                      <input type="checkbox" name="tiposQueReciben" value={t.valor} defaultChecked={config.tiposQueReciben.includes(t.valor)} /> {t.etiqueta}
                    </span>
                  ))}
                  <Ayuda>Un tipo que no marques (o un operador sin tipo) queda retenido, no se envía.</Ayuda>
                </fieldset>
              </div>
            </section>

            <section className="card p-4 space-y-3">
              <h2 className="font-display text-[15px] font-semibold">3. Cómo se ve el desglose</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <Etiqueta t="Renglón de viaje">
                  <span className="flex items-center gap-2 text-[12.5px]">
                    <input type="checkbox" name="agruparViaje" defaultChecked={config.agruparViaje} disabled={off} /> Juntar los conceptos de viaje en un solo renglón
                  </span>
                </Etiqueta>
                <Etiqueta t="Etiqueta del renglón de viaje">
                  <input name="etiquetaViaje" defaultValue={config.etiquetaViaje} maxLength={MAX_ETIQUETA} className={CSS_INPUT} style={ESTILO_INPUT} disabled={off} />
                </Etiqueta>
                <Etiqueta t="Conceptos que se funden en el viaje (uno por renglón)">
                  <textarea name="conceptosViaje" rows={3} defaultValue={config.conceptosViaje.join('\n')} className={CSS_INPUT} style={ESTILO_INPUT} disabled={off} />
                </Etiqueta>
                <Etiqueta t="Renombres (uno por renglón: concepto → etiqueta)">
                  <textarea name="renombres" rows={3} defaultValue={renombres.map((r) => `${r.texto} → ${r.a}`).join('\n')} placeholder="(sin renombres)" className={CSS_INPUT} style={ESTILO_INPUT} disabled={off} />
                  <Ayuda>Cambia el nombre con que un concepto aparece en el desglose; el importe no cambia.</Ayuda>
                </Etiqueta>
              </div>
            </section>

            <section className="card p-4 space-y-3">
              <h2 className="font-display text-[15px] font-semibold">4. Qué retiene el envío</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <Etiqueta t="Conceptos que retienen el envío (uno por renglón)">
                  <textarea name="conceptosProhibidos" rows={3} defaultValue={config.conceptosProhibidos.join('\n')} placeholder="(ninguno)" className={CSS_INPUT} style={ESTILO_INPUT} disabled={off} />
                  <Ayuda>Si un desglose trae alguno, no sale: queda a la espera de que alguien lo revise y lo libere.</Ayuda>
                </Etiqueta>
                <Etiqueta t="Neto negativo">
                  <select name="netoNegativo" defaultValue={config.netoNegativo} className={CSS_INPUT} style={ESTILO_INPUT} disabled={off}>
                    <option value="retener">Retener el envío</option>
                    <option value="enviar">Enviar de todos modos</option>
                  </select>
                </Etiqueta>
              </div>
            </section>

            {puedeAdministrar && disponible && (
              <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}><Save width={13} height={13} strokeWidth={2} /> Guardar configuración</button>
            )}
          </form>
        </div>
      </div>
    </main>
  );
}
