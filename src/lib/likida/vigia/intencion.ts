// ═══════════════════════════════════════════════════════════════════════════
// INTENCIÓN POR REGLAS — la primera capa del clasificador, y la que MANDA.
//
// Un cliente de transporte pregunta pocas cosas, y casi siempre con las mismas
// palabras: ¿dónde va mi viaje?, ¿a qué hora llega?, ¿qué documento falta?, ¿me
// mandan la factura / el POD?, o se queja, o pide hablar con alguien. Esas se
// reconocen con reglas: sin costo, sin latencia y sin que un modelo decida nada.
//
// El modelo (clasificador.ts) solo ve lo que las reglas NO reconocen, y aun así
// su salida es un enum que el código vuelve a validar.
//
// Prioridad (de más a menos delicada — ante la duda, un humano):
//   baja > pide_humano > queja > ETA/ubicación/documentos/factura > saludo
// «baja» solo se reconoce por regla determinista: dar de baja a alguien es un
// efecto legal que ningún modelo decide.
// ═══════════════════════════════════════════════════════════════════════════
import { normalizar } from './entrada';
import type { Clasificacion, Intencion } from './tipos';

const BAJA: readonly RegExp[] = [
  /^(baja|stop|alto|cancelar|unsubscribe|no mas|ya no)$/,
  /\b(dar(me)? de baja|date de baja|dame de baja|quiero la baja|solicito la baja)\b/,
  /\bno (quiero|deseo) (recibir )?(mas )?(mensajes|notificaciones|avisos)\b/,
  /\b(dejen de (escribirme|mandarme|enviarme)|ya no me (escriban|manden|envien))\b/,
  /\bcancel(ar|en|a) (mi )?(suscripcion|mensajes)\b/,
];

const PIDE_HUMANO: readonly RegExp[] = [
  /\b(hablar|comunicar(me)?|pasame|pasenme|contactar(me)?)\b[^.]{0,30}\b(persona|humano|alguien|asesor|ejecutivo|ejecutiva|gerente|supervisor|supervisora|encargado|encargada|responsable|ser humano)\b/,
  /\b(quiero|necesito|prefiero|requiero)\b[^.]{0,20}\b(un humano|una persona|persona real|un asesor|una asesora|un ejecutivo|hablar con)\b/,
  /\b(llamenme|llameme|llamarme|que me llamen|marquenme)\b/,
  /\b(eres (un )?(bot|robot)|es (un )?(bot|robot)|no eres (una )?(persona|humano))\b/,
  /\b(con quien hablo|quien me atiende)\b/,
];

const QUEJA: readonly RegExp[] = [
  /\b(queja|reclamo|reclamacion|inconformidad|inconforme|denuncia|demanda|profeco)\b/,
  /\b(mal servicio|pesimo|pesima|terrible|inaceptable|vergonzoso|una burla|negligencia|incompetentes?|irresponsables?|estafa|fraude)\b/,
  /\b(muy molesto|molesta|enojado|enojada|harto|harta|furioso|indignado|indignada|decepcionado|decepcionada)\b/,
  /\b(nadie (me )?(contesta|responde|atiende)|no me (contestan|responden|hacen caso|atienden)|siguen sin (contestar|responder))\b/,
  /\bllevo (horas|dias|mucho|todo el dia) (esperando|sin)\b/,
  /\b(exijo|exigimos|voy a (cancelar|cambiar de proveedor|reportar|demandar)|cancelo (el|mi|los) (contrato|servicio|viajes?))\b/,
  /\b(danado|danada|dano|danaron|mercancia (danada|robada|perdida)|faltante|robo|robaron|se perdio)\b/,
];

const ETA: readonly RegExp[] = [
  /\b(a que hora|que hora)\b[^.]{0,25}\b(llega|llegan|llegaria|entrega|entregan|arriba|descarga|descargan|estaria)\b/,
  /\b(cuando|para cuando)\b[^.]{0,25}\b(llega|llegan|llegaria|entregan|entrega|estaria|descargan|va a llegar|me llega|nos llega)\b/,
  /\b(cuanto (falta|tarda|le falta|les falta|demora)|tiempo (estimado|de llegada|de entrega)|hora (estimada|de llegada|de entrega)|eta)\b/,
  /\b(para que (dia|hora)|en cuanto tiempo|cuantas horas)\b/,
];

const UBICACION: readonly RegExp[] = [
  /\bdonde\b[^.]{0,25}\b(va|esta|anda|viene|vienen|se encuentra|quedo|queda|van|andan)\b/,
  /\b(ubicacion|ubicar|localizar|rastreo|rastrear|tracking|posicion|en que parte|por donde|en donde|que tan lejos|ya salio|ya salieron|ya va|ya viene)\b/,
  /\b(como va|como van|como esta)\b[^.]{0,20}\b(mi|el|la|los|las)\b[^.]{0,20}\b(viaje|carga|camion|unidad|entrega|pedido|embarque|flete)\b/,
  /\b(estatus|estado|status|avance)\b[^.]{0,25}\b(viaje|carga|camion|unidad|entrega|pedido|embarque|flete)\b/,
];

const DOCUMENTOS: readonly RegExp[] = [
  /\b(que|cual(es)?)\b[^.]{0,15}\b(documentos?|papeles|papeleria|tramites?)\b[^.]{0,20}\b(falta|faltan|me falta|hacen falta|necesitan|requieren|pendientes?)\b/,
  /\b(documentos?|papeles|papeleria)\b[^.]{0,20}\b(pendientes?|faltantes?|falta|faltan)\b/,
  /\b(falta (algun|algo|un) (documento|papel|tramite)|que (les|le) falta de mi parte)\b/,
  /\b(carta porte|cartaporte|remision|orden de compra|pedimento|manifiesto|documentacion)\b/,
];

const FACTURA_POD: readonly RegExp[] = [
  /\b(factura|facturas|cfdi|xml|timbre|timbrado|nota de credito)\b/,
  /\b(pod|comprobante de entrega|prueba de entrega|acuse de (entrega|recibo)|evidencia de entrega|foto de (la )?entrega|remision firmada|firmada de recibido)\b/,
];

// Saludos y acuses cortos: se comparan como FRASE (hasta una palabra extra: «hola María»),
// no con una regex —así no hay cuantificadores anidados que vigilar.
const SALUDOS = new Set([
  'hola', 'buenas', 'buenos dias', 'buen dia', 'buenas tardes', 'buenas noches', 'que tal', 'saludos', 'hey', 'hi', 'ola',
  'gracias', 'muchas gracias', 'ok', 'enterado', 'listo', 'perfecto', 'de acuerdo', 'vale', 'excelente', 'muy bien',
]);

function esSaludo(n: string): boolean {
  if (SALUDOS.has(n)) return true;
  const i = n.lastIndexOf(' ');
  if (i <= 0) return false;
  const resto = n.slice(i + 1);
  return resto.length <= 20 && /^[a-z]+$/.test(resto) && SALUDOS.has(n.slice(0, i));
}

function coincide(n: string, reglas: readonly RegExp[]): boolean {
  return reglas.some((r) => r.test(n));
}

const ORDEN_DATO: ReadonlyArray<[Intencion, readonly RegExp[]]> = [
  ['eta', ETA],
  ['ubicacion', UBICACION],
  ['documentos', DOCUMENTOS],
  ['factura_pod', FACTURA_POD],
];

/**
 * Clasifica por reglas. `null` = las reglas no reconocen el mensaje (le toca al
 * modelo, si lo hay). Nunca lanza.
 */
export function clasificarPorReglas(texto: string): Clasificacion | null {
  const n = normalizar(texto);
  if (!n) return null;

  // «baja» solo se reconoce en mensajes CORTOS: «la baja de la unidad 12» o «mi
  // jefe dio de baja la orden» no son un opt-out, y dar de baja por error es
  // peor que contestar de más.
  if (n.length <= 60 && coincide(n, BAJA)) {
    return { intencion: 'baja', secundarias: [], confianza: 0.99, clasificador: 'reglas', senales: [] };
  }
  if (coincide(n, PIDE_HUMANO)) {
    return { intencion: 'pide_humano', secundarias: [], confianza: 0.95, clasificador: 'reglas', senales: [] };
  }
  if (coincide(n, QUEJA)) {
    return { intencion: 'queja', secundarias: [], confianza: 0.9, clasificador: 'reglas', senales: [] };
  }
  const datos = ORDEN_DATO.filter(([, reglas]) => coincide(n, reglas)).map(([i]) => i);
  if (datos.length > 0) {
    return {
      intencion: datos[0], secundarias: datos.slice(1), confianza: datos.length === 1 ? 0.9 : 0.85,
      clasificador: 'reglas', senales: [],
    };
  }
  if (esSaludo(n)) {
    return { intencion: 'saludo', secundarias: [], confianza: 0.9, clasificador: 'reglas', senales: [] };
  }
  return null;
}
