// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/unidades — el parque vehicular con sus vigencias de ley.
//
// Es la ruta que más vale de las cuatro para un TMS ajeno, porque el dato que
// devuelve no lo tiene el TMS: si una unidad puede salir HOY a carretera. Una
// unidad con la verificación vencida o el permiso SICT caducado no es una
// unidad con un papel pendiente, es una unidad que no debería estar rodando, y
// la multa, la detención y el seguro que no responde son del dueño de la flota.
//
// El motor ya existía (`getUnidades` elige el papel MÁS PRÓXIMO a vencer de los
// tres y devuelve los días, negativos si ya venció) y la clasificación también
// (`clasificarVigencia`). Aquí se juntan para que el número y su significado
// viajen en la misma respuesta: mandar `diasAlVencimiento: -3` a pelo obliga al
// integrador a reimplementar el criterio, y a la tercera implementación una de
// ellas va a decir que -3 es "vigente".
//
// ── `sin_dato` NO ES `vigente`, Y ESA ES LA LÍNEA ────────────────────────
//
// `diasAlVencimiento: null` significa que a esa unidad NADIE le capturó papeles.
// No está en regla: está sin verificar. La API lo manda como estado
// `sin_dato`, nunca como `vigente` ni como 0 días. Pintarla en verde sería el
// caso exacto que este producto no se permite — el gerente la vería en la lista
// de "todo al día" y se enteraría del problema cuando lo pare un inspector.
//
// Área `operacion`: aquí no se enseña un peso, y el jefe de tráfico es
// EXACTAMENTE quien debe enterarse de que una unidad no puede salir.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { getUnidades, crearUnidad, type UnidadRow, type NuevaUnidad } from '@/lib/likida/operacion';
import { clasificarVigencia, contarVigencias, DIAS_AVISO, type EstadoVigencia } from '@/lib/likida/vigencias';
import { abrir, leerPagina, rebanar, sobre, fallo } from '../_comun';
import {
  leerCuerpo, leerLlaveIdempotencia, validar, escribir, huella,
  texto, entero, CampoInvalido,
  buscarUnidadPorEconomico, type UnidadCreada,
  ANIO_MIN_UNIDAD,
} from '../_escritura';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface UnidadApi {
  id: string;
  numeroEconomico: string;
  placas: string | null;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  /** Dominio de `unidad.estado` (0047): disponible, en_viaje, taller, baja. */
  estado: string;
  /** `null` = no se ha capturado el odómetro. NUNCA 0. */
  kmActual: number | null;
  activo: boolean;
  ordenesAbiertas: number;
  vigencia: {
    /** vencido | por_vencer | vigente | sin_dato. */
    estado: EstadoVigencia;
    /** Días al vencimiento MÁS PRÓXIMO de los tres papeles. NEGATIVO = ya
     *  venció. `null` = ningún papel capturado, y entonces `estado` es
     *  `sin_dato` — que no es lo mismo que estar en regla. */
    diasAlVencimiento: number | null;
    /** Cuál de los tres papeles es el que vence antes. `null` sin dato. */
    queVence: string | null;
    /** La frase ya conjugada, la misma que ve el gerente en el panel. */
    rotulo: string;
    /** Si esto le pide algo a una persona HOY. */
    pide: boolean;
  };
}

function aUnidadApi(u: UnidadRow): UnidadApi {
  const v = clasificarVigencia(u.diasAlVencimiento, u.queVence);
  return {
    id: u.id,
    numeroEconomico: u.numeroEconomico,
    placas: u.placas,
    marca: u.marca,
    modelo: u.modelo,
    anio: u.anio,
    estado: u.estado,
    kmActual: u.kmActual,
    activo: u.activo,
    ordenesAbiertas: u.ordenesAbiertas,
    vigencia: {
      estado: v.estado,
      diasAlVencimiento: u.diasAlVencimiento,
      queVence: u.queVence,
      rotulo: v.rotulo,
      pide: v.pide,
    },
  };
}

export async function GET(req: Request) {
  const acceso = await abrir(req, 'operacion');
  if (!acceso.ok) return acceso.respuesta;

  const pag = leerPagina(req.url);
  if (!pag.ok) return pag.respuesta;

  try {
    // `getUnidades` usa `traerTodo`: o trae TODAS las unidades de la flota o
    // lanza `LecturaIncompleta`. Por eso aquí el total es exacto y se puede
    // rebanar en memoria sin arriesgar el salto de filas que tendría un
    // `range` sobre un orden que empata (`numero_economico` no es único).
    const todas = await getUnidades(acceso.tenantId);
    const resumen = contarVigencias(todas);

    return NextResponse.json({
      ...sobre(rebanar(todas, pag.pagina).map(aUnidadApi), pag.pagina, todas.length),
      // El resumen es de la FLOTA ENTERA, no de la página: es lo que se pinta
      // en un semáforo, y un semáforo calculado sobre 50 de 300 unidades diría
      // que no hay nada vencido porque los vencidos cayeron en la página 3.
      resumen: {
        ...resumen,
        /** Con cuántos días de anticipación empieza a avisar `por_vencer`.
         *  Viaja en la respuesta para que el integrador no lo adivine ni lo
         *  fije por su cuenta en otro número. */
        diasAviso: DIAS_AVISO,
      },
    });
  } catch (e) {
    return fallo('v1.unidades', e, { tenant: acceso.tenantId });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/unidades — dar de alta el parque desde el TMS de la flota.
//
// Una flota que estrena Likida tiene entre 20 y 300 unidades ya capturadas en
// su sistema. Teclearlas otra vez a mano no es solo trabajo: es la primera
// oportunidad de que el número económico no coincida entre los dos sistemas, y
// a partir de ahí ninguna unidad se puede cruzar.
//
// ── ÁREA `administracion`, aunque el GET sea `operacion` ─────────────────
//
// LEER el parque es del jefe de tráfico —es exactamente quien debe enterarse
// de que una unidad no puede salir— y por eso el `GET` de arriba es
// `operacion`. DARLA DE ALTA es del dueño: una unidad nueva es un activo de la
// empresa y su alta cambia el denominador de todo lo que se mide por unidad.
// Son dos permisos distintos y aquí se piden distintos.
//
// ── LO QUE ESTA RUTA NO CAPTURA, Y POR QUÉ ───────────────────────────────
//
// Ni `estado`, ni `kmActual`, ni las TRES FECHAS DE VIGENCIA (póliza, permiso
// SICT, verificación), que son lo más valioso que devuelve el `GET`. No es un
// olvido: `crearUnidad` (`NuevaUnidad`, en `lib/likida/operacion.ts`) no las
// acepta, y ampliarla toca un archivo que esta entrega no puede tocar. Una
// unidad creada por aquí nace con `vigencia.estado = 'sin_dato'`, que es la
// verdad —nadie le capturó papeles— y no `vigente`, que sería la mentira que
// la cabecera de este archivo existe para prohibir. Queda anotado en el
// reporte de entrega, no fingido en el código.
// ═══════════════════════════════════════════════════════════════════════════

/** El primer año de una unidad de carga que siga rodando. Un `1900` es un
 *  dedazo; un año en el futuro lejano también. `+2` porque los modelos se
 *  venden adelantados. */

function normalizarUnidad(cuerpo: Record<string, unknown>, hoy = new Date()): NuevaUnidad {
  // Igual que en `POST /v1/viajes`: un `tenant_id` en el cuerpo no se lee aquí
  // ni en ningún otro sitio de la ruta. El tenant sale de `abrir()`.
  const numeroEconomico = texto(cuerpo, 'numeroEconomico', { obligatorio: true, max: 40 });
  if (!numeroEconomico) throw new CampoInvalido('numeroEconomico', '`numeroEconomico` es obligatorio.');

  return {
    numeroEconomico,
    placas: texto(cuerpo, 'placas', { max: 20 }),
    marca: texto(cuerpo, 'marca', { max: 60 }),
    modelo: texto(cuerpo, 'modelo', { max: 60 }),
    anio: entero(cuerpo, 'anio', { min: ANIO_MIN_UNIDAD, max: hoy.getUTCFullYear() + 2 }),
  };
}

export async function POST(req: Request) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;

  const llave = leerLlaveIdempotencia(req);
  if (!llave.ok) return llave.respuesta;

  const cuerpo = await leerCuerpo(req);
  if (!cuerpo.ok) return cuerpo.respuesta;

  const v = validar('v1.unidades.post', () => normalizarUnidad(cuerpo.cuerpo));
  if (!v.ok) return v.respuesta;
  const nueva = v.valor;

  return escribir<UnidadCreada>({
    evento: 'v1.unidades.post',
    tenantId: acceso.tenantId,
    llave: llave.llave,
    huella: huella({
      numeroEconomico: nueva.numeroEconomico,
      placas: nueva.placas ?? null,
      marca: nueva.marca ?? null,
      modelo: nueva.modelo ?? null,
      anio: nueva.anio ?? null,
    }),
    // (tenant_id, numero_economico), mig. 0047. Es la red durable: el número
    // económico es como la flota llama a la unidad en la radio y en el papel,
    // así que un reintento trae el mismo y choca aquí en vez de crear un
    // segundo camión que no existe.
    restriccion: 'unidad_economico_unico',
    buscar: () => buscarUnidadPorEconomico(acceso.tenantId, nueva.numeroEconomico),
    crear: async () => ({
      id: await crearUnidad(acceso.tenantId, nueva),
      numeroEconomico: nueva.numeroEconomico,
    }),
  });
}
