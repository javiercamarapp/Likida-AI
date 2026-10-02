// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO DEL KIT DE CARGA (máquina-legible) — la fuente de la tabla de
// docs/demo/innovativos.md. Una prueba (`catalogo_kit.test.ts`) exige que cada
// entrada exista aquí Y en el documento, y que cada archivo de muestra exista:
// así el kit no puede decir algo que el código ya no hace.
//
// «estado» del importador:
//   existe     ya está en esta rama (se usa tal cual);
//   en_rama    lo construye otro stream del loop (se integra al fusionar su rama);
//   contrato   no existe aún: lo fija `contratos.ts`, con fixtures y prueba.
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
    importador: { estado: 'contrato', donde: 'LectorTablaPropia (src/lib/likida/demo_innovativos/contratos.ts); referencia CSV en lector_tabla_propia.ts; el stream w3-gps-jornada aporta el asentador común de posiciones' },
    pantalla: '/dashboard/mapa y /dashboard/agentes/conductores',
  },
  {
    id: 'geocercas', agentes: ['Conductor/Vigía', 'Peajes'],
    muestra: 'gps/geocercas.csv',
    formato: 'codigo, nombre, tipo (circulo|poligono), lat_centro, lon_centro, radio_m, poligono_wkt, cliente',
    importador: { estado: 'existe', donde: 'catálogo de sitios del Conductor (importar_sitios_conductor 0385, conductor/sitios.ts) — vía geocercasASitiosCsv; polígonos se aproximan a círculo' },
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
    id: 'liquidaciones', agentes: ['Liquidación fase 1'],
    muestra: 'liquidacion/liquidaciones_sistema.csv',
    formato: 'una fila por renglón: clave_externa, numero_empleado, periodo, folios_viaje, concepto, tipo, monto, total_sistema',
    importador: { estado: 'existe', donde: 'POST /api/v1/liquidaciones-externas (liquidacion_externa/esquema.ts); el convertidor CSV→cuerpo es liquidacion_csv.ts; la plantilla de liquidación por flota la construye w3-agentes-1-4' },
    pantalla: '/dashboard/agentes/liquidacion',
  },
  {
    id: 'convenios', agentes: ['Conductor/Vigía', 'Orquestador'],
    muestra: 'convenios/convenios.csv',
    formato: 'una fila por instrucción: clave, cliente, convenio, origen, destino, categoria, momento, orden, texto, tarifa, requisitos_cobro',
    importador: { estado: 'en_rama', donde: 'w3-convenios (0580: cliente_convenio, convenio_instruccion, convenio_comercial); el seed los carga ahí si las tablas existen' },
    pantalla: '/dashboard/clientes (convenio) y el mensaje de despacho al operador',
  },
  {
    id: 'whatsapp', agentes: ['Vigía'],
    muestra: 'whatsapp/grupo_afb_silao_ios.txt',
    formato: 'exportación de WhatsApp (.txt o .zip) de cada grupo crítico, iOS o Android',
    importador: { estado: 'en_rama', donde: 'w3-conductor-vigia (vigia/historial/export_whatsapp.ts, zip_lector.ts, pantalla «Grupos e histórico»)' },
    pantalla: '/dashboard/agentes/vigia',
  },
  {
    id: 'carta_porte', agentes: ['Carta Porte'],
    muestra: 'carta_porte/orden_c05_1.pdf',
    formato: 'los documentos de 3 a 5 clientes grandes (PDF, Excel, CSV) y su Excel/sistema de carga',
    importador: { estado: 'existe', donde: 'bandeja de Carta Porte multi-formato (carta_porte_docs/servicio.ts, perfiles.ts) + exportación por mapeo (exportacion.ts, cp_export_config)' },
    pantalla: '/dashboard/carta-porte/documentos',
  },
];
