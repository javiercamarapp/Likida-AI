import type { Ilu, PistaContextual } from './tipos';

// Las pistas contextuales viven APARTE del catálogo de pantallas: el proveedor del recorrido corre en el navegador y no debe arrastrar
// el catálogo completo (cientos de textos de todas las pantallas). Una prueba vigila que el cliente no importe `pantallas.ts`.
// Evita el literal «/dashboard/carta-porte/borrador» (la pantalla real es dinámica) en el barrido de enlaces vivos.
const RUTA_CARTA_PORTE = '/dashboard/carta-porte';

// ───────────────────────────────────────────────────────────────────────────
// PISTAS CONTEXTUALES: pantallas que no están en el menú (subpantallas y detalles). No suman pasos al recorrido; aparecen
// una vez, al abrir la pantalla, y se descartan con «Entendido». `desde` = la pantalla de la que se llega.
// ───────────────────────────────────────────────────────────────────────────
const pista = (ilu: Ilu, desde: string, titulo: string, texto: string): PistaContextual => ({ ilu, desde, titulo, texto });

export const PISTAS_CONTEXTUALES: Readonly<Record<string, PistaContextual>> = {
  '/dashboard/[id]': pista('corte', '/dashboard/agentes/liquidacion', 'El detalle de una liquidación', 'Anticipo, comprobado y diferencia, con el fundamento de cada cifra. Revisa, ajusta o rechaza antes de firmar.'),
  '/dashboard/integraciones': pista('nodos', '/dashboard/conexiones', 'Esta pantalla se fusionó con Conexiones', 'Lo que buscas vive ahora en Conexiones. Esta dirección sigue abriendo para no romper enlaces guardados.'),
  [`${RUTA_CARTA_PORTE}/borrador/[id]`]: pista('lista', '/dashboard/carta-porte', 'El borrador de Carta Porte', 'Revisa lo que falta y quién lo declara. El borrador se valida antes de timbrar; aquí no se emite nada.'),
  '/dashboard/agentes/liquidacion/formato': pista('corte', '/dashboard/agentes/liquidacion', 'Tu formato de liquidación', 'Likida toma el dato del pago y lo manda al operador con el formato que ya usas.'),
  '/dashboard/agentes/liquidacion/configuracion': pista('panel', '/dashboard/agentes/liquidacion', 'Cómo se entrega el desglose', 'Quién lo recibe, cómo se ve y qué conceptos retienen el envío.'),
  '/dashboard/agentes/peajes/configuracion': pista('panel', '/dashboard/agentes/peajes', 'Configuración del conciliador', 'Buzón, entradas y mapeos con los que el agente cruza el estado de cuenta contra los viajes.'),
  '/dashboard/agentes/peajes/reclamacion': pista('corte', '/dashboard/agentes/peajes', 'Reporte de reclamación', 'Los cruces candidatos a reclamo, el cierre mensual y el seguimiento de cada reclamo.'),
  '/dashboard/agentes/carta-porte/catalogo': pista('lista', '/dashboard/agentes/carta-porte', 'Catálogo del cliente', 'Lo que el agente aprende una vez de cada cliente: productos, remitentes, destinatarios y su número interno.'),
  '/dashboard/agentes/carta-porte/referencia': pista('lista', '/dashboard/agentes/carta-porte', 'Referencia del cliente', 'Algunos clientes exigen su referencia para cobrar. Aquí ves los viajes cargados que no la traen.'),
  '/dashboard/agentes/carta-porte/configuracion': pista('panel', '/dashboard/agentes/carta-porte', 'Configuración de la salida', 'Cómo sale la plantilla hacia el sistema del cliente y qué hace el agente cuando falta algo.'),
  '/dashboard/agentes/vigia/historial': pista('chat', '/dashboard/agentes/vigia', 'Grupos de clientes e histórico', 'Marca los grupos de WhatsApp de tus clientes críticos y sube el chat exportado para ver qué preguntan más.'),
  '/dashboard/agentes/vigia/programa': pista('importar', '/dashboard/agentes/vigia', 'Programa de despacho', 'Sube el archivo del programa para que el agente avise a tus clientes.'),
  '/dashboard/agentes/vigia/importacion': pista('lista', '/dashboard/agentes/vigia', 'Estatus de importación', 'El estatus de cada viaje se deriva del archivo que subes. Si el archivo no lo dice, aquí tampoco.'),
  '/dashboard/agentes/vigia/avisos': pista('campana', '/dashboard/agentes/vigia', 'Avisos de viaje', 'El agente arma los avisos para tus clientes. Confírmalos, edítalos o descártalos antes de que salgan.'),
  '/dashboard/agentes/conductores/sitios': pista('mapa', '/dashboard/agentes/conductores', 'Catálogo de sitios', 'Clientes, plantas y andenes con su centro y su radio. Ninguna coordenada se calcula ni se inventa.'),
  '/dashboard/agentes/conductores/estadias': pista('linea', '/dashboard/agentes/conductores', 'Estadías en andén', 'El tiempo entre llegada y salida de cada carga o descarga, con la hora exacta del mensaje del chofer.'),
  '/dashboard/agentes/conductores/configuracion': pista('panel', '/dashboard/agentes/conductores', 'Configuración del agente', 'Cuándo y cuánto insiste el agente con tus choferes, en qué horario y a quién avisa si nadie contesta.'),
};
