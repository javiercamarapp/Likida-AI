import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { hoyMx, OFFSET_MX } from '@/lib/formato';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import {
  leerJornadas, leerPolitica, nombresDeOperadores,
  anularAsiento, cerrarDia, asentarMarca, guardarPolitica,
  JornadaIlegible,
} from '@/lib/likida/jornada/repo';
import { correoDelUsuario } from '@/lib/likida/jornada/firma';
import { componerJornada, type TipoAsiento } from '@/lib/likida/jornada/modelo';
import { evaluarRiesgoDia, type PoliticaFlota } from '@/lib/likida/jornada/riesgo';
import { evaluarSemanas, type SemanaEvaluada } from '@/lib/likida/jornada/semanas';
import { sufijoTenant } from '../sufijo';
import { VistaJornada, type FilaJornada } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/jornada';

/** Cuántos días atrás mira la pantalla por omisión. Una quincena es el grano
 *  al que un contralor revisa nómina, y cabe en una lectura. */
const DIAS_POR_OMISION = 14;

const TIPOS_VALIDOS: readonly TipoAsiento[] = [
  'inicio_jornada', 'fin_jornada', 'inicio_descanso', 'fin_descanso',
];

export type ResultadoAccion = { ok: boolean; mensaje?: string; error?: string };

/** Los `?vista=`/`?tenant=`/`?rol=` que la puerta necesita para resolver la
 *  sesión efectiva. Son strings: viajan por closure a las server actions sin
 *  problema, a diferencia de una función. */
type ParamsPuerta = { vista?: string; tenant?: string; rol?: string };

/**
 * LAS DOS PUERTAS, OTRA VEZ, DENTRO DE LA ACCIÓN.
 *
 * Vive a NIVEL DE MÓDULO y no en el cuerpo del componente. Una función
 * declarada adentro y usada dentro de un `'use server'` se captura por closure,
 * y Next no puede serializarla: la página revienta con «Functions cannot be
 * passed directly to Client Components» y las cuatro acciones dejan de
 * funcionar. Lo vigila `server_actions_sin_closures.test.ts`, que fue quien lo
 * cazó aquí.
 */
async function puerta(sp: ParamsPuerta): Promise<{ tenantId: string; userId: string } | ResultadoAccion> {
  const s = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no ve el registro de jornada.' };
  if (!puedeAdministrar(s.rol)) {
    return { ok: false, error: 'Solo quien administra la flota corrige el registro de jornada.' };
  }
  return { tenantId: s.tenantId, userId: s.userId };
}

/**
 * La firma de quien corrige. `null` cuando no se pudo leer su correo, y el
 * llamador FALLA CERRADO: los CHECK de la 0241 exigen la firma, y una
 * corrección anónima es exactamente lo que este registro existe para impedir.
 *
 * El `userId` sale de `puerta()` —la sesión recién re-resuelta—, nunca del
 * formulario: nada de lo que manda el navegador decide quién firma.
 */
async function firma(userId: string): Promise<{ id: string; email: string } | null> {
  const email = await correoDelUsuario(userId);
  return email !== null ? { id: userId, email } : null;
}

/**
 * EL REGISTRO DE JORNADA — la pantalla del contralor (LFT 132 fr. XXXIV, 0241).
 *
 * ── ÁREA `operacion`, Y NO ES UN DESCUIDO ────────────────────────────────
 * Aquí no hay un peso. El usuario natural es el jefe de tráfico: es quien sabe
 * a qué hora salió cada quien y el único que puede corregirlo con conocimiento.
 * Mismo criterio que /dashboard/operadores y /dashboard/unidades.
 *
 * ── VER ES `operacion`; CORREGIR ES `puedeAdministrar` ───────────────────
 * Corregir la hora registrada de un trabajador es un acto con consecuencia
 * jurídica —el art. 805 de la LFT convierte el desaseo de este documento en
 * una presunción en contra del patrón—, así que se pide el mismo permiso que
 * para tocar los datos de un operador. Y LAS DOS PUERTAS SE VUELVEN A
 * COMPROBAR DENTRO DE CADA SERVER ACTION: el rol del render es el del momento
 * en que se pintó, y una server action es un POST alcanzable sin pasar por
 * aquí.
 *
 * ── LA CORRECCIÓN NO SOBREESCRIBE ───────────────────────────────────────
 * No hay ningún camino en esta pantalla que mueva un `momento`. Corregir es
 * anular con motivo (queda el asiento, con firma y hora) y capturar uno nuevo
 * que lo apunte con `corrige_a`. Un registro que se puede editar sin dejar
 * rastro es peor que no tenerlo: además de no probar nada, prueba que se toca.
 */
export default async function PaginaJornada({
  searchParams,
}: {
  searchParams: Promise<{
    vista?: string; tenant?: string; rol?: string;
    desde?: string; hasta?: string; operador?: string; abrir?: string;
  }>;
}) {
  const sp = await searchParams;
  // El `userId` del render NO se saca aquí A PROPÓSITO: cada server action
  // vuelve a resolver la sesión con `puerta(sp)` y firma con ESE id. Arrastrar
  // el del render sería firmar una corrección con el usuario que pintó la
  // pantalla, que puede no ser el que la envió — y aquí la firma es lo que hace
  // que la anotación valga.
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);

  const hoy = hoyMx(new Date());
  const fecha = /^\d{4}-\d{2}-\d{2}$/;
  const hasta = fecha.test(sp.hasta ?? '') ? String(sp.hasta) : hoy;
  const desdeOmision = new Date(Date.parse(`${hasta}T00:00:00Z`) - (DIAS_POR_OMISION - 1) * 86_400_000)
    .toISOString().slice(0, 10);
  const desde = fecha.test(sp.desde ?? '') && String(sp.desde) <= hasta ? String(sp.desde) : desdeOmision;

  // ── UNA LECTURA CAÍDA NO SE DISFRAZA DE «NO HAY REGISTRO» (FE-3) ────────
  // Es la distinción que más importa de esta pantalla: «no pude leer» y «el
  // operador no reportó» se ven idénticos si el catch se traga el error, y el
  // segundo es una afirmación sobre la jornada de una persona.
  let filas: FilaJornada[] | null = null;
  let truncada = false;
  let politica: PoliticaFlota | null = null;
  let motivoIlegible: string | null = null;

  // EL `try` ENVUELVE SOLO LAS TRES LECTURAS, no el cálculo. Si `componerJornada`
  // o `evaluarRiesgoDia` tuvieran un bug, un `catch` ancho se lo enseñaría al
  // contralor como «no se pudo leer el registro» — o sea, escondería un error de
  // cálculo detrás de un mensaje de base de datos caída. Aquí un bug del motor
  // revienta la página, que es lo que un bug debe hacer.
  let lectura: Awaited<ReturnType<typeof leerJornadas>> | null = null;
  let nombres: Awaited<ReturnType<typeof nombresDeOperadores>> | null = null;
  try {
    lectura = await leerJornadas(tenantId, desde, hasta, sp.operador ?? null);
    politica = await leerPolitica(tenantId);
    nombres = await nombresDeOperadores(tenantId, lectura.dias.map((d) => d.operadorId));
  } catch (e) {
    // `truncada` se REGRESA a false: si `leerPolitica` cayó después de una
    // lectura truncada, pintar «este periodo no cupo» junto a «no pude leer»
    // afirmaría algo sobre una lista que no se está enseñando.
    lectura = null;
    nombres = null;
    truncada = false;
    motivoIlegible = e instanceof JornadaIlegible ? e.message : 'No se pudo leer el registro de jornada.';
  }

  if (lectura !== null && nombres !== null) {
    truncada = lectura.truncada;
    const catalogo = nombres;
    filas = lectura.dias.map((d) => {
      const jornada = componerJornada(d.asientos);
      const riesgo = evaluarRiesgoDia(jornada, politica);
      const o = catalogo.get(d.operadorId);
      return {
        jornadaId: d.id,
        operadorId: d.operadorId,
        // Nunca un nombre inventado: si ya no está en el catálogo, se dice.
        operadorNombre: o?.nombre ?? `Operador dado de baja (${d.operadorId.slice(0, 8)})`,
        dia: d.dia,
        estado: d.estado,
        cerradoPorEmail: d.cerradoPorEmail,
        conformeOperadorEn: d.conformeOperadorEn,
        jornada,
        riesgo,
      };
    });
  }

  // ── EL EJE SEMANAL (tableros al día, 28-ago-2026) ────────────────────────
  // `evaluarRiesgoSemana`, el tope del Transitorio Segundo, el art. 69 y
  // `horas_min_entre_jornadas` estaban escritos, probados y SIN UN SOLO
  // llamador — esta pantalla resumía por día y nunca decía si la semana
  // rebasó las 48 h. `semanas.ts` es el pegamento puro.
  //
  // SOBRE UNA LECTURA TRUNCADA NO SE CONCLUYE NADA SEMANAL: los días que no
  // cupieron podrían ser justo los que rebasan, y una semana evaluada sobre el
  // recorte diría «va bien» con los datos que faltan. `null` aquí = no se
  // evaluó, y la vista lo dice con esas palabras.
  const semanas: SemanaEvaluada[] | null = filas !== null && !truncada
    ? evaluarSemanas(
      filas.map((f) => ({ operadorId: f.operadorId, operadorNombre: f.operadorNombre, dia: f.dia, jornada: f.jornada })),
      politica, desde, hasta,
    )
    : null;

  async function anularMarca(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const p = await puerta(sp);
    if ('ok' in p) return p;
    const f = await firma(p.userId);
    if (!f) {
      return { ok: false, error: 'No pude confirmar tu correo, y una corrección sin firma no queda anotada. Vuelve a intentarlo.' };
    }

    const asientoId = String(fd.get('asientoId') ?? '').trim();
    const motivo = String(fd.get('motivo') ?? '').trim();
    if (!asientoId) return { ok: false, error: 'Falta la marca que se va a anular.' };
    if (motivo.length < 5) {
      return { ok: false, error: 'Escribe el motivo de la corrección. Una anulación sin explicación no sirve como anotación.' };
    }

    const r = await anularAsiento({
      tenantId: p.tenantId, asientoId, motivo, usuarioId: f.id, usuarioEmail: f.email,
    });
    if (!r.ok) return { ok: false, error: r.error };

    await anotarBitacora({
      tenantId: p.tenantId,
      actor: { id: f.id, email: f.email },
      accion: 'jornada.marca_anulada',
      entidad: 'jornada_dia',
      entidadId: String(fd.get('jornadaId') ?? asientoId),
      detalle: { asiento: asientoId, motivo },
    }, { evento: 'jornada.bitacora_no_escribio' });

    revalidatePath(RUTA);
    return { ok: true, mensaje: 'Marca anulada. Queda en el expediente con tu nombre, la hora y el motivo.' };
  }

  async function capturarMarca(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const p = await puerta(sp);
    if ('ok' in p) return p;
    const f = await firma(p.userId);
    if (!f) {
      return { ok: false, error: 'No pude confirmar tu correo, y una captura sin firma no queda anotada. Vuelve a intentarlo.' };
    }

    const jornadaId = String(fd.get('jornadaId') ?? '').trim();
    const tipo = String(fd.get('tipo') ?? '') as TipoAsiento;
    // `datetime-local` manda 'AAAA-MM-DDTHH:MM' SIN zona. Se ancla al huso de
    // México a mano: interpretarlo como UTC movería la hora capturada seis
    // horas, y esa hora es la que después se compara contra un tope legal.
    const cuando = String(fd.get('momento') ?? '').trim();
    const nota = String(fd.get('nota') ?? '').trim();

    if (!jornadaId) return { ok: false, error: 'Falta el día al que va la marca.' };
    if (!TIPOS_VALIDOS.includes(tipo)) return { ok: false, error: 'Ese tipo de marca no existe.' };
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(cuando)) {
      return { ok: false, error: 'Captura la fecha y la hora completas.' };
    }
    const momento = new Date(`${cuando}:00${OFFSET_MX}`);
    if (!Number.isFinite(momento.getTime())) return { ok: false, error: 'Esa fecha y hora no se entienden.' };

    const corrigeA = String(fd.get('corrigeA') ?? '').trim() || null;
    const res = await asentarMarca({
      jornadaId,
      tenantId: p.tenantId,
      tipo,
      momento,
      procedencia: 'capturado_contralor',
      registradoPor: f.id,
      registradoPorEmail: f.email,
      nota: nota || null,
      corrigeA,
    });
    if (res === 'fallo') return { ok: false, error: 'No se pudo guardar la marca. Intenta de nuevo en un momento.' };
    if (res === 'ya_estaba') {
      return {
        ok: false,
        error: 'Ya hay una marca viva de ese tipo en ese día. Anúlala primero (con su motivo) y luego captura la correcta.',
      };
    }

    await anotarBitacora({
      tenantId: p.tenantId,
      actor: { id: f.id, email: f.email },
      accion: 'jornada.marca_capturada',
      entidad: 'jornada_dia',
      entidadId: jornadaId,
      detalle: { tipo, corrige_a: corrigeA },
    }, { evento: 'jornada.bitacora_no_escribio' });

    revalidatePath(RUTA);
    return { ok: true, mensaje: 'Marca capturada, con tu nombre y la hora en que la capturaste.' };
  }

  async function cerrarElDia(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const p = await puerta(sp);
    if ('ok' in p) return p;
    const f = await firma(p.userId);
    if (!f) return { ok: false, error: 'No pude confirmar tu correo, y el cierre lleva firma. Vuelve a intentarlo.' };

    const jornadaId = String(fd.get('jornadaId') ?? '').trim();
    if (!jornadaId) return { ok: false, error: 'Falta el día que se va a cerrar.' };

    const r = await cerrarDia({ tenantId: p.tenantId, jornadaId, usuarioId: f.id, usuarioEmail: f.email });
    if (!r.ok) return { ok: false, error: r.error };

    await anotarBitacora({
      tenantId: p.tenantId,
      actor: { id: f.id, email: f.email },
      accion: 'jornada.dia_cerrado',
      entidad: 'jornada_dia',
      entidadId: jornadaId,
    }, { evento: 'jornada.bitacora_no_escribio' });

    revalidatePath(RUTA);
    return { ok: true, mensaje: 'Día cerrado con tu firma. Si algo cambia después, se corrige y queda anotado.' };
  }

  async function declararPolitica(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const p = await puerta(sp);
    if ('ok' in p) return p;
    const f = await firma(p.userId);
    if (!f) return { ok: false, error: 'No pude confirmar tu correo, y declarar un umbral lleva firma. Vuelve a intentarlo.' };

    // VACÍO SIGNIFICA «NO DECLARADO», Y SE GUARDA COMO NULL. Convertirlo en 0
    // pondría un tope de cero horas que marcaría excedido todo — el `null`
    // jamás se vuelve 0 de la casa, aquí con consecuencias visibles.
    const num = (k: string): number | null => {
      const v = String(fd.get(k) ?? '').trim();
      if (v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const r = await guardarPolitica({
      tenantId: p.tenantId,
      horasMaxJornada: num('horasMaxJornada'),
      minutosMinDescanso: num('minutosMinDescanso'),
      horasMinEntreJornadas: num('horasMinEntreJornadas'),
      fundamento: String(fd.get('fundamento') ?? '').trim() || null,
      usuarioId: f.id,
      usuarioEmail: f.email,
    });
    if (!r.ok) return { ok: false, error: r.error };

    await anotarBitacora({
      tenantId: p.tenantId,
      actor: { id: f.id, email: f.email },
      accion: 'jornada.politica_declarada',
      entidad: 'jornada_dia',
      entidadId: p.tenantId,
    }, { evento: 'jornada.bitacora_no_escribio' });

    revalidatePath(RUTA);
    return { ok: true, mensaje: 'Umbrales de la flota guardados, con tu nombre y la fecha.' };
  }

  return (
    <VistaJornada
      filas={filas}
      semanas={semanas}
      motivoIlegible={motivoIlegible}
      truncada={truncada}
      politica={politica}
      desde={desde}
      hasta={hasta}
      sufijo={sufijo}
      operador={sp.operador ?? null}
      abrir={sp.abrir ?? null}
      puedeCorregir={puedeAdministrar(rol)}
      anularMarca={anularMarca}
      capturarMarca={capturarMarca}
      cerrarElDia={cerrarElDia}
      declararPolitica={declararPolitica}
    />
  );
}
