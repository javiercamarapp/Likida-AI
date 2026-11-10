import { ArrowLeft, Save } from 'lucide-react';
import '../liquidacion.css';

// SOLO tipos y constantes: el repo importa supabaseAdmin y no debe entrar al bundle de la vista.
import type { ConfigCorreo, CanalEntrega, Revisor } from '@/lib/likida/liquidacion_externa/repo_correo';
import { hoyMx } from '@/lib/formato';
import {
  AvisoCompacto, Boton, BotonEnlace, Casilla, CampoFecha, CampoSelect, CampoTexto, CampoTextarea, Fieldset, Icono, MarcoPagina, Tarjeta,
} from '@/app/ui-v2/componentes';

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
export const MAX_REVISORES = 5;
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

/** AAAA-MM-DD + n días (calendario UTC: la fecha ya es el día de México). */
export function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** «departamento: correo» por renglón (también «=», «,» o «;»), p. ej. «nomina: nomina@empresa.mx». */
export function leerRevisores(texto: string): Revisor[] | string {
  const salida: Revisor[] = [];
  for (const [i, l] of lineas(texto, /\n+/).entries()) {
    const m = /^\s*([^\s:=,;]+)\s*[:=,;]\s*(\S+)\s*$/.exec(l);
    if (!m) return `Revisor ${i + 1}: escríbelo como «departamento: correo» (por ejemplo «nomina: nomina@empresa.mx»).`;
    const departamento = m[1].trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const correo = m[2].trim().toLowerCase();
    if (!/^[a-z_]{2,30}$/.test(departamento)) return `Revisor ${i + 1}: el departamento va en letras, sin espacios (por ejemplo «nomina» o «rh»).`;
    if (correo.length > MAX_CORREO || !FORMA_CORREO.test(correo)) return `Revisor ${i + 1}: el correo no tiene forma de correo (revisa que lleve @ y dominio).`;
    salida.push({ departamento, correo });
  }
  return salida;
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

    const revisoresLeidos = leerRevisores(String(fd.get('revisores') ?? ''));
    if (typeof revisoresLeidos === 'string') return { ok: false, error: revisoresLeidos };
    if (revisoresLeidos.length > MAX_REVISORES) return { ok: false, error: `Puedes poner hasta ${MAX_REVISORES} revisores; pusiste ${revisoresLeidos.length}.` };
    if (new Set(revisoresLeidos.map((r) => r.departamento)).size !== revisoresLeidos.length) return { ok: false, error: 'Un solo revisor por departamento.' };
    const primerMes = fd.get('primerMes') === 'on';
    const hastaTxt = String(fd.get('primerMesHasta') ?? '').trim();
    if (primerMes && revisoresLeidos.length === 0) return { ok: false, error: 'Activaste el modo primer mes: pon al menos un revisor (departamento: correo).' };
    if (primerMes && !/^\d{4}-\d{2}-\d{2}$/.test(hastaTxt)) return { ok: false, error: 'Activaste el modo primer mes: indica hasta qué día dura (AAAA-MM-DD).' };
    const primerMesHasta = primerMes ? hastaTxt : null;

    // A1-01: fecha de corte. Vacía = sin corte (se envía todo lo que llegue); con fecha, lo anterior se guarda pero no se envía.
    const corteTxt = String(fd.get('noEnviarAntes') ?? '').trim();
    if (corteTxt !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(corteTxt) || Number.isNaN(Date.parse(`${corteTxt}T00:00:00Z`)))) {
      return { ok: false, error: 'La fecha de corte debe ser un día válido (AAAA-MM-DD).' };
    }
    const noEnviarAntes = corteTxt === '' ? null : corteTxt;

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
        remitenteCorreo: correo('Correo emisor', String(fd.get('remitenteCorreo') ?? '')),
        revisores: revisoresLeidos,
        primerMesHasta,
        noEnviarAntes,
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
    <MarcoPagina titulo="Configuración del desglose" apoyo="Cómo se entrega el desglose de cada liquidación, quién lo recibe, cómo se ve y qué conceptos retienen el envío." acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/liquidacion${sufijo}`} icono={<Icono icono={ArrowLeft} />}>Volver al agente</BotonEnlace>}>
      {aviso && <AvisoCompacto tono="info" resumen={aviso} />}
      {error && <AvisoCompacto tono="error" resumen={error} />}

      {!disponible && (
        <AvisoCompacto tono="error" resumen="La configuración de la entrega por correo todavía no está disponible en esta base. No se puede leer ni guardar nada hasta que se aplique." />
      )}
      {disponible && !hayFila && (
        <AvisoCompacto tono="info" resumen="Todavía no hay configuración guardada: el agente sigue entregando por WhatsApp y no se manda nada por correo. El envío por correo no se activa solo; tú lo enciendes cuando esté todo listo." />
      )}
      {!puedeAdministrar && (
        <p className="rv-liq-sub">Solo el dueño de la flota cambia esta configuración.</p>
      )}

      <form action={acciones.guardar} className="rv-liq-config">
        <Tarjeta titulo="1. Entrega" info="liquidacion_config.entrega">
          <div className="rv-liq-dos">
            <CampoSelect etiqueta="Canal" name="canal" defaultValue={config.canal} disabled={off}>
              {CANALES.map((c) => <option key={c.valor} value={c.valor}>{c.etiqueta}</option>)}
            </CampoSelect>
            <Casilla etiqueta="Activar el envío por correo" name="activa" defaultChecked={config.activa} disabled={off}
              ayuda="Apagado, no sale ningún correo aunque haya desgloses listos: quedan en espera y salen solos al encenderlo." />
            <CampoTexto etiqueta="Nombre del remitente" name="remitenteNombre" defaultValue={config.remitenteNombre ?? ''} maxLength={MAX_ETIQUETA} placeholder="(sin definir)" disabled={off} />
            <CampoTexto tipo="email" etiqueta="Responder a" name="responderA" defaultValue={config.responderA ?? ''} maxLength={MAX_CORREO} placeholder="(sin definir)" disabled={off}
              ayuda="A este correo llegan las respuestas del operador. Si lo dejas vacío se usa el correo emisor; sin ninguno de los dos no se envía nada." />
            <CampoTexto tipo="email" etiqueta="Correo emisor de la empresa" name="remitenteCorreo" defaultValue={config.remitenteCorreo ?? ''} maxLength={MAX_CORREO} placeholder="(sin definir)" disabled={off}
              ayuda="El correo desde el que la empresa manda hoy los desgloses. Hoy los correos salen por Likida y las respuestas llegan aquí; el envío desde este mismo buzón queda para cuando su área de TI lo autorice." />
            <CampoTexto tipo="number" etiqueta="Hora mínima de envío (0 a 23)" name="enviarDesdeHora" min={0} max={23} step={1} defaultValue={config.enviarDesdeHora ?? ''} placeholder="(sin restricción)" disabled={off} />
          </div>
        </Tarjeta>

        <Tarjeta titulo="2. Quién lo recibe" info="liquidacion_config.destinatarios">
          <div className="rv-liq-dos">
            <CampoTextarea etiqueta={`Correos de RH (hasta ${MAX_RH}, uno por renglón)`} name="rhCorreos" rows={3} defaultValue={config.rhCorreos.join('\n')} placeholder="(vacío: RH no recibe copia)" disabled={off} />
            <CampoTexto tipo="email" etiqueta="Buzón de archivo" name="archivoCorreo" defaultValue={config.archivoCorreo ?? ''} maxLength={MAX_CORREO} placeholder="(sin definir)" disabled={off}
              ayuda="Recibe una copia de cada desglose para el archivo de la empresa." />
            <Casilla etiqueta="Enviar también al coordinador del operador" name="enviaCoordinador" defaultChecked={config.enviaCoordinador} disabled={off} />
            <Fieldset leyenda="Tipos de operador que reciben su desglose" ayuda="Un tipo que no marques (o un operador sin tipo) queda retenido, no se envía.">
              {TIPOS_OPERADOR.map((t) => (
                <Casilla key={t.valor} etiqueta={t.etiqueta} name="tiposQueReciben" value={t.valor} defaultChecked={config.tiposQueReciben.includes(t.valor)} disabled={off} />
              ))}
            </Fieldset>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Fecha de corte del arranque" info="liquidacion_config.fecha_corte">
          <p className="rv-liq-sub">
            Los desgloses cuyo periodo termina ANTES de esta fecha se guardan, pero no se envían a nadie (quedan «omitidos»). Pon el día en que arranca
            el envío: así subir el histórico no manda nóminas viejas a los operadores, coordinadores ni RH. Vacío = se envía todo lo que llegue.
          </p>
          <div className="rv-liq-dos">
            <CampoFecha etiqueta="No enviar desgloses anteriores a (AAAA-MM-DD)" name="noEnviarAntes" defaultValue={config.noEnviarAntes ?? ''} disabled={off} />
          </div>
        </Tarjeta>

        <Tarjeta titulo="Primer mes: revisión por departamento" info="liquidacion_config.primer_mes">
          <p className="rv-liq-sub">
            Durante el primer mes, cada desglose —enviado o retenido— le llega también por correo al revisor de cada departamento, con el mismo Excel.
            Al terminar la fecha, el modo se apaga solo.
          </p>
          <div className="rv-liq-dos">
            <Casilla etiqueta="Activar la revisión por departamento" name="primerMes" defaultChecked={config.primerMesHasta !== null} disabled={off} />
            <CampoFecha etiqueta="Dura hasta (AAAA-MM-DD, inclusive)" name="primerMesHasta" defaultValue={config.primerMesHasta ?? sumarDias(hoyMx(), 30)} disabled={off} />
            <CampoTextarea etiqueta={`Revisores (hasta ${MAX_REVISORES}, «departamento: correo» por renglón)`} name="revisores" rows={3}
              defaultValue={config.revisores.map((r) => `${r.departamento}: ${r.correo}`).join('\n')} placeholder={'nomina: …\nrh: …'} disabled={off} />
          </div>
        </Tarjeta>

        <Tarjeta titulo="3. Cómo se ve el desglose" info="liquidacion_config.formato">
          <div className="rv-liq-dos">
            <Casilla etiqueta="Juntar los conceptos de viaje en un solo renglón" name="agruparViaje" defaultChecked={config.agruparViaje} disabled={off} />
            <CampoTexto etiqueta="Etiqueta del renglón de viaje" name="etiquetaViaje" defaultValue={config.etiquetaViaje} maxLength={MAX_ETIQUETA} disabled={off} />
            <CampoTextarea etiqueta="Conceptos que se funden en el viaje (uno por renglón)" name="conceptosViaje" rows={3} defaultValue={config.conceptosViaje.join('\n')} disabled={off} />
            <CampoTextarea etiqueta="Renombres (uno por renglón: concepto → etiqueta)" name="renombres" rows={3} defaultValue={renombres.map((r) => `${r.texto} → ${r.a}`).join('\n')} placeholder="(sin renombres)" disabled={off}
              ayuda="Cambia el nombre con que un concepto aparece en el desglose; el importe no cambia." />
          </div>
        </Tarjeta>

        <Tarjeta titulo="4. Qué retiene el envío" info="liquidacion_config.retencion">
          <div className="rv-liq-dos">
            <CampoTextarea etiqueta="Conceptos que retienen el envío (uno por renglón)" name="conceptosProhibidos" rows={3} defaultValue={config.conceptosProhibidos.join('\n')} placeholder="(ninguno)" disabled={off}
              ayuda="Si un desglose trae alguno, no sale: queda a la espera de que alguien lo revise y lo libere." />
            <CampoSelect etiqueta="Neto negativo" name="netoNegativo" defaultValue={config.netoNegativo} disabled={off}>
              <option value="retener">Retener el envío</option>
              <option value="enviar">Enviar de todos modos</option>
            </CampoSelect>
          </div>
        </Tarjeta>

        {puedeAdministrar && disponible && (
          <div className="rv-liq-acciones">
            <Boton type="submit" variante="primary" icono={<Icono icono={Save} />}>Guardar configuración</Boton>
          </div>
        )}
      </form>
    </MarcoPagina>
  );
}
