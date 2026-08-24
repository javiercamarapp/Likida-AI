// ═══════════════════════════════════════════════════════════════════════════
// INTEGRACIONES — los sistemas que la flota YA usa, y cómo se conecta Likida
// con cada uno.
//
// La arquitectura separa dos secciones en el chasis y la diferencia importa:
// «Conexiones» son CREDENCIALES (los accesos que los agentes de Likida usan para
// trabajar) e «Integraciones» son los SISTEMAS DE NEGOCIO del cliente (su CRM,
// su ERP, su Drive). Aquí es igual: `/dashboard/conexiones` ya cubre las
// credenciales medidas (WhatsApp, datos fiscales, portales, rastreo, timbrado);
// esta pantalla cubre lo otro.
//
// LA REGLA QUE HACE ÚTIL A ESTA PÁGINA: cada renglón dice CÓMO conecta HOY, no
// si "está disponible". La diferencia entre "subes el archivo del TAG cada 10
// días" y "nos conectamos solos a tu TAG" es toda la diferencia para quien va a
// comprar — y prometer la segunda cuando lo que hay es la primera es la forma
// más rápida de perder al cliente en la segunda semana.
//
// Por eso el estado NO es un semáforo verde/rojo. Un `por_archivo` es un
// estado LEGÍTIMO y terminado: el Agente de Peajes concilia de verdad, solo que
// el desglose entra subiéndolo. Pintarlo ámbar diría que está a medias, y no lo
// está.
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoIntegracion =
  /** Medido para ESTA flota: hay una conexión comprobada en uso. */
  | 'conectada'
  /** Funciona hoy y completo, pero el dato entra por archivo, no en vivo. */
  | 'por_archivo'
  /** Construido; falta que la flota entregue o pruebe sus accesos. */
  | 'por_credencial'
  /** Existe el camino, pero el último tramo necesita una instancia real de un
   *  cliente firmado. No se promete antes de tenerla. */
  | 'por_piloto'
  /** No está construido. Se dice, no se esconde. */
  | 'no_construida';

export interface Integracion {
  id: string;
  nombre: string;
  categoria: 'Contabilidad y ERP' | 'Rastreo' | 'Combustible y casetas' | 'Documentos';
  /** Qué resuelve, en una línea, en palabras del dueño de la flota. */
  queHace: string;
  estado: EstadoIntegracion;
  /** Cómo entra el dato HOY. Es el campo que evita la venta mal entendida. */
  comoConectaHoy: string;
  /** Qué haría falta para subir de escalón, o `null` si ya está en el tope. */
  paraSubirDeEscalon: string | null;
}

export const ESTADO_INTEGRACION: Record<EstadoIntegracion, { rotulo: string; tono: 'ok' | 'neutral' | 'warn' | 'apagado' }> = {
  conectada: { rotulo: 'Conectada', tono: 'ok' },
  por_archivo: { rotulo: 'Por archivo', tono: 'neutral' },
  por_credencial: { rotulo: 'Falta conectar', tono: 'warn' },
  por_piloto: { rotulo: 'Con cliente piloto', tono: 'warn' },
  no_construida: { rotulo: 'Todavía no', tono: 'apagado' },
};

/** Lo medido que hace falta para resolver los estados que dependen del tenant. */
export interface SenalesIntegracion {
  /** Credenciales de rastreo guardadas. `null` = no se pudo leer. */
  credencialesRastreo: number | null;
}

/**
 * El catálogo, con los estados que dependen de la flota ya resueltos.
 *
 * Es una función y no una constante porque dos de los renglones se MIDEN. Los
 * demás son verdades del producto, iguales para todas las flotas, y por eso van
 * escritos: inventar un estado por tenant para algo que no varía sería fingir
 * medición.
 */
export function catalogoIntegraciones(s: SenalesIntegracion): Integracion[] {
  const rastreo: EstadoIntegracion =
    s.credencialesRastreo === null ? 'por_credencial'
      : s.credencialesRastreo > 0 ? 'conectada' : 'por_credencial';

  return [
    // ── Contabilidad y ERP ────────────────────────────────────────────────
    {
      id: 'export_csv',
      nombre: 'Exportación a tu contabilidad (CSV)',
      categoria: 'Contabilidad y ERP',
      queHace: 'Cada liquidación sale como archivo con su cuenta contable, UUID del CFDI, estado ante el SAT y desglose de IVA e IEPS.',
      estado: 'por_archivo',
      comoConectaHoy: 'Descargas el archivo del panel y lo importas. Lo lee Excel y casi cualquier sistema contable.',
      paraSubirDeEscalon: 'Un layout dedicado (CONTPAQi, Aspel) se escribe contra tu archivo de ejemplo — no adivinando el formato.',
    },
    {
      id: 'sap_b1',
      nombre: 'SAP Business One',
      categoria: 'Contabilidad y ERP',
      queHace: 'Genera archivos DTW de pólizas únicamente después de que tu contador confirma la plantilla de su instancia.',
      estado: 'por_piloto',
      comoConectaHoy: 'No hay una plantilla universal declarada lista. El export pide una plantilla DTW confirmada de ESTA flota y devuelve “no listo” hasta tenerla.',
      paraSubirDeEscalon: 'Confirma con tu contador el archivo DTW de su versión/instancia y prueba una importación en ambiente controlado. La escritura directa (Service Layer) requiere accesos de prueba y no se promete antes de ello.',
    },
    {
      id: 'contpaqi_aspel',
      nombre: 'CONTPAQi · Aspel COI',
      categoria: 'Contabilidad y ERP',
      queHace: 'El layout de póliza que tu contador importa sin retecleo.',
      estado: 'por_piloto',
      comoConectaHoy: 'El export solo genera CONTPAQi con el tipo, separador y encabezado confirmados por tu contador; sin ese perfil devuelve “no listo”.',
      paraSubirDeEscalon: 'Entrega una póliza de ejemplo y el esquema de carga de tu instalación. Un layout adivinado no falla ruidosamente: importa mal y ensucia el cierre.',
    },

    // ── Rastreo ───────────────────────────────────────────────────────────
    {
      id: 'gps',
      nombre: 'Rastreo GPS de tu proveedor',
      categoria: 'Rastreo',
      queHace: 'Que el mapa pinte posiciones reales y los tiempos de espera se midan solos, en vez de trayectos ilustrativos.',
      // Una credencial guardada NO es una posición recibida ni una sincronía
      // exitosa. Esta pantalla no lee un latido/última posición, así que no
      // usa el verde de “conectada” aunque exista una fila de credencial.
      estado: rastreo === 'conectada' ? 'por_credencial' : rastreo,
      comoConectaHoy: rastreo === 'conectada'
        ? 'Hay una credencial registrada, pero esta pantalla no puede comprobar aquí que el proveedor esté entregando posiciones. Confírmalo con una sincronización y una posición reciente.'
        : 'Sin conectar: el mapa dibuja el trayecto entre origen y destino y lo declara como ilustrativo — nunca como posición actual.',
      paraSubirDeEscalon: rastreo === 'conectada'
        ? 'Ejecuta una sincronización y confirma una posición reciente antes de tratar el GPS como conectado.'
        : 'Los accesos de tu proveedor de rastreo, en Conexiones.',
    },

    // ── Combustible y casetas ─────────────────────────────────────────────
    {
      id: 'tag_monedero',
      nombre: 'TAG de casetas y monedero de diésel',
      categoria: 'Combustible y casetas',
      queHace: 'Concilia el estado de cuenta contra los gastos reales de cada viaje, línea por línea, y arma la bitácora que pide el estímulo del 50% de peaje.',
      estado: 'por_archivo',
      comoConectaHoy: 'Subes el desglose que te manda el proveedor (Excel, CSV o PDF) y el Agente de Peajes lo cruza.',
      paraSubirDeEscalon: 'La descarga automática depende de que el proveedor tenga API o portal automatizable; se evalúa por proveedor.',
    },

    // ── Documentos ────────────────────────────────────────────────────────
    {
      id: 'whatsapp_docs',
      nombre: 'WhatsApp (comprobantes de chofer)',
      categoria: 'Documentos',
      queHace: 'El operador manda la foto del ticket y entra al viaje con su OCR, sin app que instalar.',
      estado: 'por_credencial',
      comoConectaHoy: 'La disponibilidad real del canal se mide en Conexiones; este catálogo no tiene acceso a sus credenciales ni a una prueba de entrega por flota.',
      paraSubirDeEscalon: 'Configura y prueba el canal de WhatsApp en Conexiones; una clave guardada no equivale a una entrega confirmada.',
    },
    {
      id: 'intake_correo',
      nombre: 'Buzón de correo para facturas de proveedores',
      categoria: 'Documentos',
      queHace: 'Una dirección propia de tu flota a la que reenvías —o a la que llegan solas— las facturas de talleres, refaccionarias y diésel.',
      estado: 'por_credencial',
      comoConectaHoy: 'La disponibilidad se mide en Conexiones con el buzón de ESTA flota. Esta ficha no presupone que el dominio ni la recepción estén configurados.',
      paraSubirDeEscalon: 'Configura el buzón y prueba la recepción de un XML real; una variable de correo saliente no prueba la entrada.',
    },
  ];
}

/** Agrupa por categoría conservando el orden en que se declararon. */
export function porCategoria(items: Integracion[]): Array<[Integracion['categoria'], Integracion[]]> {
  const mapa = new Map<Integracion['categoria'], Integracion[]>();
  for (const i of items) {
    const lista = mapa.get(i.categoria);
    if (lista) lista.push(i);
    else mapa.set(i.categoria, [i]);
  }
  return [...mapa.entries()];
}
