import type { Recorrido } from '@/app/ui-v2/movimiento/tour';

// ═══════════════════════════════════════════════════════════════════════════
// RECORRIDO DEL DUEÑO (administrador de la flota) — adenda 10 del PLAN-MAESTRO.
//
// Lleva a la persona página por página y le dice EXACTAMENTE qué apretar. Es DATOS: el motor (ui-v2/movimiento/tour)
// navega, resalta el elemento real por su `data-tour` estable y avanza con «Siguiente» o con la acción pedida. Nunca se
// abre solo (lo abre «Ver recorrido»), «Saltar» siempre está, y los pasos de rutas que el rol no ve se quitan solos
// (`puedeVerRuta`). Textos breves, sin jerga; sin cifras. Si cambian los pasos, sube `version`.
// ═══════════════════════════════════════════════════════════════════════════

const ASISTENTE = '/dashboard/puesta-en-marcha';

export const RECORRIDO_DUENO: Recorrido = {
  id: 'dueno',
  version: 1,
  titulo: 'Recorrido del administrador',
  pasos: [
    {
      id: 'bienvenida', ruta: ASISTENTE, escena: 'bienvenida',
      titulo: 'Te acompaño paso por paso',
      texto: 'Te llevo de pantalla en pantalla y te digo qué apretar. Puedes saltarlo cuando quieras y volver desde «Ver recorrido».',
    },
    {
      id: 'menu', ruta: ASISTENTE, ancla: 'nav-puesta-en-marcha', lado: 'derecha',
      titulo: 'Tu punto de partida',
      texto: 'Aquí está tu avance. Mientras falte algo, verás cuántos pasos llevas junto a este nombre.',
    },
    {
      id: 'avance', ruta: ASISTENTE, ancla: 'asistente.avance', lado: 'derecha',
      titulo: 'Tu avance, sin adornos',
      texto: 'Solo cuenta lo que está listo de verdad. Si algo no se pudo comprobar, te lo dice en vez de marcarlo.',
    },
    {
      id: 'sistema', ruta: ASISTENTE, ancla: 'asistente.paso-tms', lado: 'derecha',
      titulo: 'Empieza por tu sistema de transporte',
      texto: 'De ahí salen los viajes que Likida va a liquidar.',
      accion: { verbo: 'Aprieta aquí', objetivo: 'Tu sistema de transporte' },
      avance: { tipo: 'accion', evento: 'click' },
    },
    {
      id: 'archivo', ruta: ASISTENTE, ancla: 'asistente.archivo', lado: 'izquierda',
      titulo: 'Un archivo de muestra basta para arrancar',
      texto: 'Es la vía más rápida: no tienes que esperar a que tu área de sistemas libere la conexión.',
      accion: { verbo: 'Aprieta después', objetivo: 'Entregar archivo de muestra' },
    },
    {
      id: 'conseguirlo', ruta: ASISTENTE, ancla: 'asistente.como-conseguirlo', lado: 'arriba',
      titulo: 'Los textos ya vienen escritos',
      texto: 'Copia la solicitud para sistemas y la carta para gerencia. La contraseña nunca va por correo.',
      accion: { verbo: 'Aprieta aquí', objetivo: 'Cómo conseguirlo' },
    },
    {
      id: 'conexiones', ruta: '/dashboard/conexiones', ancla: 'conexiones.estado', lado: 'abajo', escena: 'conexion-tms',
      titulo: 'Lo conectado, medido',
      texto: 'Cada renglón sale de una comprobación. Aquí ves qué falta, no un semáforo de adorno.',
    },
    {
      id: 'credenciales', ruta: '/dashboard/conexiones', ancla: 'conexiones.credenciales', lado: 'arriba',
      titulo: 'Aquí se guarda el acceso',
      texto: 'Cuando tu área de sistemas te lo dé, se captura una vez y queda cifrado. Luego aprietas «Probar».',
      accion: { verbo: 'Después aprieta', objetivo: 'Probar' },
    },
    {
      id: 'liquidacion', ruta: '/dashboard/agentes/liquidacion', ancla: 'nav-agentes-liquidacion', lado: 'derecha', escena: 'desglose-correo',
      titulo: 'Liquidación automática',
      texto: 'Arma la liquidación de cada viaje y manda el desglose al correo del operador. Aquí revisas lo que no cuadra.',
    },
    {
      id: 'peajes', ruta: '/dashboard/agentes/peajes', ancla: 'nav-agentes-peajes', lado: 'derecha',
      titulo: 'Conciliación de peajes',
      texto: 'Cruza el estado de cuenta de casetas contra tus viajes. Aquí subes el archivo cuando lo tengas.',
    },
    {
      id: 'carta-porte', ruta: '/dashboard/agentes/carta-porte', ancla: 'nav-agentes-carta-porte', lado: 'derecha', escena: 'documento-revision',
      titulo: 'Carta Porte',
      texto: 'Prepara el borrador y pide lo que falta. Una persona lo revisa antes de que salga: tú decides quién.',
    },
    {
      id: 'fin', ruta: ASISTENTE, ancla: 'asistente.lista', lado: 'derecha', escena: 'listo',
      titulo: 'Eso es todo por ahora',
      texto: 'Vuelve a Puesta en marcha cuando quieras: te dice qué sigue y de quién es. Puedes repetir este recorrido desde aquí.',
    },
  ],
};

export const RECORRIDOS_DASHBOARD: Recorrido[] = [RECORRIDO_DUENO];

/** Rutas que el recorrido visita (para filtrarlas con `puedeVerRuta` en el servidor). */
export function rutasDeRecorridos(recorridos: readonly Recorrido[] = RECORRIDOS_DASHBOARD): string[] {
  return [...new Set(recorridos.flatMap((r) => r.pasos.map((p) => p.ruta).filter((x): x is string => Boolean(x))))];
}
