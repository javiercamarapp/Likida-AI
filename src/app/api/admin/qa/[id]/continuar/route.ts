// ═══════════════════════════════════════════════════════════════════════════
// UNA PASADA DEL CARRIL COMPLETO — /api/admin/qa/<id>/continuar (POST).
//
// Ésta es la ruta que mueve una corrida larga. Se llama una vez por pasada:
// la primera para sembrar y empezar a mandar fotos, y las que hagan falta
// hasta que la corrida llegue a un estado terminal. La pantalla
// (/admin/qa/<id>) la empuja sola mientras la corrida siga viva.
//
// EL RELOJ DURO, TAL CUAL EL PR #152 («El reloj entra a los motores, y la ruta
// late pase lo que pase»). La ruta NO espera a la pasada: espera a la CARRERA
// entre la pasada y el reloj. `ejecutarPasada` pregunta `relojAgotado(venceEn)`
// antes de cada foto y nunca a la mitad de una, pero ese reloj es COOPERATIVO
// —funciona porque alguien se acordó de preguntar—, y el día que un
// `processInbound` se cuelgue en un fetch sin tope, o que alguien meta una fase
// nueva sin mirar el reloj, la invocación volvería a morir sin responder. Con
// `conRelojDuro` la respuesta sale pase lo que pase.
//
// Lo que el corte duro NO hace, dicho para que nadie lo suponga: no CANCELA la
// pasada. La promesa perdedora sigue corriendo hasta que Vercel apaga la
// invocación — no hay forma de matar un `await` a la mitad en JS. Lo que sí
// hace es que se responda por la puerta de la ruta en vez de por el hachazo
// del `maxDuration`, y que lo que quedó a medias esté CONTADO: la foto en
// vuelo dejó su fila 'corriendo' en `qa_corrida_foto` antes de salir, y la
// siguiente pasada la lee y la marca 'interrumpida'. Ni acierto ni fallo.
//
// La llave de la pasada (`qa_corrida.pasada_en_vuelo`) se toma con un UPDATE
// condicional, así que dos llamadas simultáneas —dos pestañas abiertas, un
// reintento del navegador— no arrancan dos pasadas: una gana y la otra
// responde diciendo por qué no hizo nada.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { conRelojDuro } from '@/lib/likida/agentes/runner';
import { ejecutarPasada } from '@/lib/admin/qa-motor';
import { TECHO_PASADA_MS } from '@/lib/admin/qa-tipos';
import { logger } from '@/lib/logger';
import { sesionSuperadmin } from '../../puerta';
import { vieneDeNuestroSitio } from '@/lib/auth/csrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// El mismo techo que el cron del runner (300 s). El motor se auto-limita a
// `TECHO_PASADA_MS` para alcanzar a ESCRIBIR su corte y soltar la llave antes
// de que Vercel mate la función.
//
// TIENE QUE SER UN LITERAL, y no `MAX_DURATION_PASADA_S`. Next lee la config
// de segmento con un análisis ESTÁTICO del módulo —no lo ejecuta—, así que un
// identificador importado no lo sabe resolver: el build truena con «Unknown
// identifier "MAX_DURATION_PASADA_S" at "maxDuration"». Escribirlo a mano abre
// la puerta a que los dos números se separen en silencio, y un `maxDuration`
// de 300 con un techo calculado sobre otro número dejaría a la pasada sin
// margen para cerrar; por eso `continuar.test.ts` compara este archivo contra
// la constante y falla si alguien mueve uno sin el otro.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // AUDITORÍA 24, BE-26: sus hermanos (`qa/lanzar`, `qa/fotos` POST y PATCH)
  // ya lo hacían; estos dos no. Autenticados solo por cookie de sesión, un
  // sitio ajeno con el superadmin logueado podía dispararlos desde un form.
  // Mitigado por `sameSite: lax`, pero el candado se pone donde falta.
  if (!vieneDeNuestroSitio(req)) {
    logger.warn('qa_continuar.origen_ajeno', { origen: req.headers.get('origin'), sitio: req.headers.get('sec-fetch-site') });
    return NextResponse.json({ error: 'Petición de otro sitio.' }, { status: 403 });
  }

  const { error, sesion } = await sesionSuperadmin();
  if (error) return error;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'id inválido' }, { status: 404 });

  // El presupuesto de trabajo sale de `TECHO_PASADA_MS` (= maxDuration menos
  // el margen del cierre) y no de una resta escrita aquí: el margen se
  // justifica paso por paso en qa-tipos.ts y se compara contra la suma en una
  // prueba, y repetir la cuenta aquí sería el segundo lugar donde puede
  // quedarse desactualizada.
  const venceEn = Date.now() + TECHO_PASADA_MS;

  const r = await conRelojDuro(
    ejecutarPasada(id, venceEn),
    venceEn,
    // Qué se responde cuando el reloj duro gana. No se inventa avance: lo que
    // se afirma es lo único que se sabe con certeza desde aquí —que la
    // invocación se acabó— y se manda a releer el estado, que es donde la
    // pasada fue dejando la verdad foto por foto.
    () => ({
      ok: true as const,
      corrio: true as const,
      pasada: null,
      motivo: 'CORTE DURO: la invocación se acabó mientras la pasada seguía trabajando. Lo que alcanzó a medirse quedó escrito foto por foto; la foto que estaba en vuelo se marcará como INTERRUMPIDA en la siguiente pasada (ni acierto ni fallo). Vuelve a llamar para continuar.',
      fotosProcesadas: 0,
      corte: 'reloj' as const,
      terminada: false,
      avance: null,
      corrida: null,
    }),
  );

  logger.info('qa.pasada', {
    corrida: id, pasada: r.pasada, corrio: r.corrio, corte: r.corte,
    fotos: r.fotosProcesadas, terminada: r.terminada,
    motivo: r.motivo.slice(0, 200), por: sesion.userId ?? null,
  });

  // Un `ok:false` es "no se pudo ni intentar" (base ilegible, corrida
  // inexistente, carril equivocado): 502 con el motivo entero, nunca un 200
  // que parezca una pasada que corrió.
  if (!r.ok) return NextResponse.json({ error: r.motivo }, { status: 502 });

  return NextResponse.json({
    pasada: r.pasada,
    corrio: r.corrio,
    motivo: r.motivo,
    fotosProcesadas: r.fotosProcesadas,
    corte: r.corte,
    terminada: r.terminada,
    avance: r.avance,
  });
}
