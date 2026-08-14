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
import { getUnidades, type UnidadRow } from '@/lib/likida/operacion';
import { clasificarVigencia, contarVigencias, DIAS_AVISO, type EstadoVigencia } from '@/lib/likida/vigencias';
import { abrir, leerPagina, rebanar, sobre, fallo } from '../_comun';

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
