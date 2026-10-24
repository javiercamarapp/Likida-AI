// ═══════════════════════════════════════════════════════════════════════════
// /v1/liquidaciones-externas — la liquidación que YA calculó el SAP/TMS del
// cliente, para que Likida la ENTREGUE al chofer por WhatsApp.
//
// Es el modo opuesto al de fotos (`/v1/liquidaciones`, el cierre que el motor
// cuadró y una persona firmó): aquí la cifra NO es nuestra. Likida no la
// recalcula, no la mezcla con las del motor y no la deja salir por
// `/v1/liquidaciones` — son dos recursos a propósito (ver la 0370).
//
// ── POST ─────────────────────────────────────────────────────────────────────
//
// Área `administracion`: es una escritura de dinero que termina en el teléfono
// de una persona con la firma de su patrón.
//
// IDEMPOTENCIA — la llave natural es `claveExterna` (el folio en el sistema del
// cliente), no una cabecera que haya que acordarse de mandar:
//   · misma clave + mismo contenido  → 200 `idempotente: true` (un reintento);
//   · misma clave + OTRO contenido   → 409. No se sobrescribe: el chofer pudo
//     haber visto ya la primera. La corrección va con otra clave;
//   · `Idempotency-Key` es OPCIONAL aquí (a diferencia de `/v1/viajes`): si
//     viene se honra; si no, se deriva de la clave externa.
//
// La respuesta es 201 aunque la entrega esté `en_cola`: lo que se acusa es que
// Likida RECIBIÓ y guardó la liquidación. Si ya salió, llegó, o el chofer
// contestó, se consulta con GET — la entrega es asíncrona (cola + reintentos).
//
// ── GET ──────────────────────────────────────────────────────────────────────
//
// Área `dinero`. Lista paginada por cursor, con filtros `estado`, `respuestaChofer`,
// `operadorId`, `claveExterna`, `desde` y `hasta` (días de México sobre la fecha de
// carga).
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { abrir, leerPagina, leerCursor, sobre, fallo, errorApi, codificarCursor } from '../_comun';
import { leerCuerpo, leerLlaveIdempotencia, escribir, huella, validar, CABECERA_IDEMPOTENCIA } from '../_escritura';
import {
  validarLiquidacionExterna, huellaContenido, MAX_CUERPO_LIQUIDACION_BYTES,
} from '@/lib/likida/liquidacion_externa/esquema';
import {
  buscarPorClave, leerPorId, listarLiquidacionesExternas, ESTADOS,
  type EstadoLiquidacionExterna, type FiltroListado,
} from '@/lib/likida/liquidacion_externa/repo';
import { recibirLiquidacionExterna, intentarEntrega, dependenciasPorOmision } from '@/lib/likida/liquidacion_externa/servicio';
import { leerConfigCorreo } from '@/lib/likida/liquidacion_externa/repo_correo';
import { aLiquidacionExternaApi, type LiquidacionExternaApi } from '@/lib/likida/liquidacion_externa/api';
import { DatoInvalido } from '@/lib/likida/errores';
import { MENSAJE_CANAL_CORREO_SIN_WHATSAPP } from '@/lib/likida/liquidacion_externa/canal_correo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Genera un PDF y lo sube a Storage antes de contestar: más que un POST de
// alta, menos que un export.
export const maxDuration = 30;

async function canalEs(tenantId: string): Promise<string> {
  try {
    const c = await leerConfigCorreo(tenantId);
    return c.ok ? c.valor.canal : 'whatsapp';
  } catch {
    return 'whatsapp';
  }
}

// ── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;

  const cuerpo = await leerCuerpo(req, MAX_CUERPO_LIQUIDACION_BYTES);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const v = validar('v1.liquidaciones_externas.post', () => validarLiquidacionExterna(cuerpo.cuerpo));
  if (!v.ok) return v.respuesta;
  const datos = v.valor;
  const huellaDelContenido = huellaContenido(datos);

  // La llave de `escribir()` (recuerdo en memoria + durable): la que manda el
  // integrador, o una derivada de la clave externa. Si manda una, tiene que
  // tener forma de llave; si no manda ninguna, no es un error.
  let llave: string;
  if (req.headers.get(CABECERA_IDEMPOTENCIA)) {
    const l = leerLlaveIdempotencia(req);
    if (!l.ok) return l.respuesta;
    llave = l.llave;
  } else {
    // A37-S11-08: la llave derivada incluye la HUELLA del contenido. Con solo la claveExterna, una
    // corrección (misma claveExterna, otros montos) chocaba en `escribir()` como «llave reusada» (400,
    // «usa una llave nueva», imposible de obedecer: no mandó ninguna) ANTES de que `buscar()` decidiera
    // el 409 documentado. Así: mismo contenido = misma llave (eco); otro contenido = llave nueva → buscar()
    // → 409 «conflicto» con la instrucción correcta (claveExterna nueva).
    llave = `lx-${createHash('sha256').update(`${datos.claveExterna}\n${huellaDelContenido}`, 'utf8').digest('hex')}`;
  }

  return escribir<LiquidacionExternaApi>({
    evento: 'v1.liquidaciones_externas.post',
    tenantId: acceso.tenantId,
    llave,
    huella: huella({ contenido: huellaDelContenido }),
    restriccion: 'liquidacion_externa_clave_unica',
    buscar: async () => {
      const existente = await buscarPorClave(acceso.tenantId, datos.claveExterna);
      if (!existente) return null;
      return { dato: aLiquidacionExternaApi(existente), coincide: existente.huella === huellaDelContenido };
    },
    mensajeConflicto:
      'Ya existe una liquidación con esa `claveExterna` y OTRO contenido. Likida no sobrescribe una liquidación ya recibida (el chofer pudo haberla visto). Si es una corrección, mándala con una `claveExterna` nueva (por ejemplo, la misma con sufijo `-R1`) y avisa a la oficina.',
    crear: async () => {
      // HALLAZGO MEDIO (oct-2026): una flota cuyo canal de entrega resuelve a `correo` (perfil `cinco_agentes`, o su
      // propia config) NO puede recibir por este endpoint. `recibirLiquidacionExterna` respeta el fail-safe y nunca
      // manda por WhatsApp — correcto —, pero esta función no genera ni inserta la fila de `liquidacion_entrega_correo`
      // (esa tabla solo la llenan `desglose_recibir.ts`/`liberar_envio.ts`/`reenvio_correo.ts`, las tres del camino
      // `/desgloses`, que SÍ arman el .xlsx que ese camino exige: `procesarEntregasCorreo` rechaza una entrega sin
      // `xlsx_ruta` y esa ruta está cerrada a `.xlsx` de un tenant — ver `exigirRutaDelTenant` en `repo_correo.ts`).
      // Reinventar esa generación aquí sería duplicar un flujo ya probado con sus propias reglas (asunto sin dinero,
      // SHA256, idempotencia por rol); se rechaza EXPLÍCITO en vez de aceptar un 201 silencioso que deja la
      // liquidación huérfana para siempre (ver `faseDeHuerfanasCorreo` en `servicio.ts`, la red que detecta el caso
      // si de todos modos ocurre). Solo se checa al CREAR: una liquidación ya existente (reintento idempotente) se
      // sigue leyendo y acusando normal, aunque haya entrado antes de este guardia.
      const canal = await dependenciasPorOmision.canalDeEntrega(acceso.tenantId);
      if (canal === 'correo') {
        throw new DatoInvalido(MENSAJE_CANAL_CORREO_SIN_WHATSAPP);
      }
      const { liquidacion } = await recibirLiquidacionExterna(acceso.tenantId, datos, huellaDelContenido);
      // Se intenta entregar YA, pero la entrega no es parte de la promesa de
      // este POST: `intentarEntrega` nunca lanza, y lo que no salga ahora lo
      // levanta el cron. Se relee para acusar el estado real, no el de antes.
      // Si la flota recibe el desglose por correo no se intenta WhatsApp. Sin config, sin la migración o con la base caída:
      // el camino de siempre (`intentarEntrega` vuelve a mirar el canal y el cron filtra por él).
      if (await canalEs(acceso.tenantId) !== 'correo') await intentarEntrega(liquidacion);
      const actual = await leerPorId(acceso.tenantId, liquidacion.id);
      return aLiquidacionExternaApi(actual ?? liquidacion);
    },
  });
}

// ── GET ─────────────────────────────────────────────────────────────────────

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function diaValido(v: string): boolean {
  if (!DIA.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export async function GET(req: Request) {
  const acceso = await abrir(req, 'dinero');
  if (!acceso.ok) return acceso.respuesta;

  const pag = leerPagina(req.url);
  if (!pag.ok) return pag.respuesta;
  const cur = leerCursor(req.url, pag.pagina);
  if (!cur.ok) return cur.respuesta;
  if (pag.pagina.desplazamiento > 0) {
    return errorApi('parametro_invalido', 'Esta ruta pagina solo por cursor: usa `despues` con el `pagina.siguiente` de la respuesta anterior, no `desplazamiento`.');
  }

  const q = new URL(req.url).searchParams;
  const filtro: FiltroListado = {};
  const estado = q.get('estado');
  if (estado) {
    if (!(ESTADOS as readonly string[]).includes(estado)) {
      return errorApi('parametro_invalido', `\`estado\` tiene que ser uno de: ${ESTADOS.join(', ')}.`);
    }
    filtro.estado = estado as EstadoLiquidacionExterna;
  }
  const respuesta = q.get('respuestaChofer');
  if (respuesta) {
    if (respuesta !== 'recibida' && respuesta !== 'no_coincide') {
      return errorApi('parametro_invalido', '`respuestaChofer` tiene que ser `recibida` o `no_coincide`.');
    }
    filtro.acuseTipo = respuesta;
  }
  const operadorId = q.get('operadorId');
  if (operadorId) {
    if (!UUID.test(operadorId)) return errorApi('parametro_invalido', '`operadorId` tiene que ser un uuid.');
    filtro.operadorId = operadorId.toLowerCase();
  }
  const clave = q.get('claveExterna');
  if (clave) {
    if (clave.length > 120) return errorApi('parametro_invalido', '`claveExterna` no puede pasar de 120 caracteres.');
    filtro.claveExterna = clave;
  }
  for (const campo of ['desde', 'hasta'] as const) {
    const valor = q.get(campo);
    if (valor) {
      if (!diaValido(valor)) return errorApi('parametro_invalido', `\`${campo}\` tiene que ser un día \`AAAA-MM-DD\`.`);
      filtro[campo] = valor;
    }
  }
  if (filtro.desde && filtro.hasta && filtro.hasta < filtro.desde) {
    return errorApi('parametro_invalido', '`hasta` no puede ser anterior a `desde`.');
  }

  try {
    const { filas, hayMas, total } = await listarLiquidacionesExternas(
      acceso.tenantId, filtro, pag.pagina.limite, cur.despues, cur.conteo,
    );
    const ultima = filas.at(-1);
    return NextResponse.json({
      ...sobre(filas.map(aLiquidacionExternaApi), pag.pagina, total, {
        hayMas,
        siguiente: hayMas && ultima ? codificarCursor({ creadoEn: ultima.creadaEn, id: ultima.id }) : null,
      }),
      // El filtro VIAJA EN LA RESPUESTA (mismo criterio que `/v1/liquidaciones`):
      // una lista corta puede significar «hay pocas» o «filtraste».
      filtro: {
        estado: filtro.estado ?? null, respuestaChofer: filtro.acuseTipo ?? null, operadorId: filtro.operadorId ?? null,
        claveExterna: filtro.claveExterna ?? null, desde: filtro.desde ?? null, hasta: filtro.hasta ?? null,
      },
    });
  } catch (e) {
    return fallo('v1.liquidaciones_externas', e, { tenant: acceso.tenantId });
  }
}
