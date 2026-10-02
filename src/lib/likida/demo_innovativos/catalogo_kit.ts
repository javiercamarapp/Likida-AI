// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO DEL KIT DE CARGA (máquina-legible) — la fuente de la tabla de
// docs/demo/innovativos.md. Una prueba (`catalogo_kit.test.ts`) exige que cada
// entrada exista aquí Y en el documento, y que cada archivo de muestra exista:
// así el kit no puede decir algo que el código ya no hace.
//
// «estado» del importador:
//   existe     ya está integrado en esta rama y es el que valida el archivo (`archivos.ts` lo llama, no lo copia);
//   en_rama    lo construye otra rama que aún no se integra;
//   contrato   no existe aún: solo hay una forma de archivo acordada.
// Tras integrar el nivel 0 (A, B, P1–P6) los nueve tipos son `existe`; una prueba
// (`muestras_importadores_reales.test.ts`) pasa cada muestra por ese importador y la compara con lo sembrado.
// ═══════════════════════════════════════════════════════════════════════════

import type { TipoArchivoKit } from './contratos';

export interface EntradaKit {
  id: TipoArchivoKit;
  /** Qué agente(s) del demo lo necesitan. */
  agentes: string[];
  /** Archivo de muestra (relativo a scripts/demo/innovativos/archivos-muestra/). */
  muestra: string;
  /** Qué se espera, en una línea. */
  formato: string;
  importador: { estado: 'existe' | 'en_rama' | 'contrato'; donde: string };
  /** Pantalla donde se ve el resultado (ruta del panel). */
  pantalla: string;
}

export const KIT: readonly EntradaKit[] = [
  {
    id: 'gps_posiciones', agentes: ['Conductor/Vigía', 'Peajes', 'Orquestador'],
    muestra: 'gps/gps_posicion_muestra.csv',
    formato: 'vista/tabla de solo lectura (o CSV) con unidad, lat, lon, fecha_hora local sin zona, velocidad, ignición',
    importador: { estado: 'existe', donde: 'conector de tabla propia (conectores/tabla_propia: lector de CSV por https y de endpoint JSON, asentador común de posiciones y cron gps; el modo SQL de solo lectura está escrito pero necesita el controlador pg y el SFTP un cliente: ambos son decisión pendiente)' },
    pantalla: '/dashboard/mapa y /dashboard/agentes/conductores',
  },
  {
    id: 'geocercas', agentes: ['Conductor/Vigía', 'Peajes'],
    muestra: 'gps/geocercas.csv',
    formato: 'codigo, nombre, tipo (circulo|poligono), lat_centro, lon_centro, radio_m, poligono_wkt, cliente',
    importador: { estado: 'existe', donde: 'catálogo de sitios del Conductor (importar_sitios_conductor 0385/0630) vía geocercasASitios: el polígono se guarda nativo y el círculo que lo contiene queda de respaldo; se re-importa solo cada día dentro del cron gps' },
    pantalla: '/dashboard/agentes/conductores/sitios',
  },
  {
    id: 'pases', agentes: ['Peajes'],
    muestra: 'peajes/pases_24h.csv',
    formato: 'Fecha, Hora, Caseta, TAG, Importe (el desglose del proveedor; encabezados tolerantes)',
    importador: { estado: 'existe', donde: 'ingesta de desglose de peaje (peajes/ingesta.ts, lector tolerante peajes/desglose.ts) + cruce GPS (peajes/cruce_gps.ts)' },
    pantalla: '/dashboard/agentes/peajes',
  },
  {
    id: 'tags', agentes: ['Peajes'],
    muestra: 'peajes/tags_unidades.csv',
    formato: 'tag;unidad;proveedor — el TAG de cada tracto (la unidad es el número económico o las placas)',
    importador: { estado: 'existe', donde: 'alta masiva de TAG (peajes/tags.ts, datos.ts)' },
    pantalla: '/dashboard/agentes/peajes/configuracion',
  },
  {
    id: 'casetas', agentes: ['Peajes'],
    muestra: 'peajes/casetas_catalogo.csv',
    formato: 'nombre;lat;lng;radio_m;alias;fuente — el catálogo de casetas con coordenadas (sin él no hay cruce con GPS)',
    importador: { estado: 'existe', donde: 'catálogo de casetas por CSV (peajes/casetas.ts)' },
    pantalla: '/dashboard/agentes/peajes/configuracion',
  },
  {
    id: 'liquidaciones', agentes: ['Liquidación fase 1'],
    muestra: 'liquidacion/liquidaciones_sistema.csv',
    formato: 'una fila por renglón: clave_externa, numero_empleado, periodo, folios_viaje, concepto, tipo, monto, total_sistema',
    importador: { estado: 'existe', donde: 'POST /api/v1/liquidaciones-externas (liquidacion_externa/esquema.ts); el convertidor CSV→cuerpo es liquidacion_externa/liquidacion_csv.ts; en el panel, /dashboard/agentes/liquidacion → «Subir liquidaciones» (CSV/Excel) lo usa y entrega por el mismo camino (liquidacion_externa/importar_archivo.ts); el formato de la flota (su Excel de muestra → plantilla, con copia al jefe y aviso de discrepancia) es liquidacion_externa/formato_flota.ts y la pantalla /dashboard/agentes/liquidacion/formato' },
    pantalla: '/dashboard/agentes/liquidacion',
  },
  {
    id: 'convenios', agentes: ['Conductor/Vigía', 'Orquestador'],
    muestra: 'convenios/convenios.csv',
    formato: 'una fila por instrucción: clave, cliente, convenio, origen, destino, categoria, momento, orden, texto, tarifa, requisitos_cobro',
    importador: { estado: 'existe', donde: 'convenios/importador.ts (0580: cliente_convenio, convenio_instruccion, convenio_comercial); el seed los carga en esas tablas y la pantalla /dashboard/convenios los importa por CSV o Excel (el alta y la edición en pantalla todavía no existen)' },
    pantalla: '/dashboard/convenios y el mensaje de despacho al operador',
  },
  {
    id: 'whatsapp', agentes: ['Vigía'],
    muestra: 'whatsapp/grupo_afb_silao_ios.txt',
    formato: 'exportación de WhatsApp (.txt o .zip) de cada grupo crítico, iOS o Android',
    importador: { estado: 'existe', donde: 'vigia/historial (export_whatsapp.ts, zip_lector.ts, analisis.ts) y la pantalla «Grupos e histórico»: grupos críticos, FAQs, tendencias, tiempos de respuesta y respuestas rápidas aprobadas' },
    pantalla: '/dashboard/agentes/vigia/historial',
  },
  {
    id: 'carta_porte', agentes: ['Carta Porte'],
    muestra: 'carta_porte/orden_c05_1.pdf',
    formato: 'los documentos de 3 a 5 clientes grandes (PDF, Excel, CSV) y su Excel/sistema de carga',
    importador: { estado: 'existe', donde: 'bandeja de Carta Porte multi-formato (carta_porte_docs/servicio.ts, perfiles.ts), el worker que la barre cada 5 min (cron carta-porte-docs, 0640-0642: reintentos con tope y aviso a la oficina) y la exportación por mapeo (exportacion.ts, cp_export_config)' },
    pantalla: '/dashboard/carta-porte/documentos',
  },
];
