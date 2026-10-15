// Fuente del programa de despacho (T-A4-09).
//
// Hoy el programa de cada terminal entra por SUBIDA MANUAL (T-A4-07). El cliente lleva un archivo por
// terminal en Drive/Sheets, «muy parecido» entre terminales, y ofreció un acceso de lectura (pendiente de
// confirmar: BLOQUEO EXTERNO B6). Este módulo fija el contrato para cuando exista ese acceso, sin ejecutor:
// la lectura automática NO está construida, falla cerrada con un mensaje llano, y no hay red ni credenciales.
// Cómo se conectaría: docs/operacion/vigia-aviso-proactivo.md, sección «Fuente automática del programa».

export type FormatoPrograma = 'csv' | 'xlsx';

export interface LecturaFuente {
  /** CSV: texto decodificado. xlsx: bytes del libro. */
  contenido: string | Uint8Array;
  formato: FormatoPrograma;
  /** ISO 8601 con zona: cuándo se modificó el archivo en su origen (o cuándo se subió, en la subida manual). */
  modificadoEn: string;
}

export interface FuenteProgramaDespacho {
  /** Identificador estable de la fuente, para mostrarlo y registrarlo ('subida_manual', 'drive'...). */
  readonly id: string;
  leer(terminal: string): Promise<LecturaFuente>;
}

/** La fuente no puede entregar el programa (no configurada, o aún no hay nada cargado). */
export class ErrorFuentePrograma extends Error {
  constructor(
    mensaje: string,
    readonly codigo: 'no_configurada' | 'sin_archivo',
  ) {
    super(mensaje);
    this.name = 'ErrorFuentePrograma';
  }
}

const clave = (terminal: string) => terminal.trim().toUpperCase().replace(/\s+/g, ' ');

/** Subida manual: guarda en memoria lo último subido por terminal y lo devuelve tal cual. */
export class SubidaManual implements FuenteProgramaDespacho {
  readonly id = 'subida_manual';
  private readonly porTerminal = new Map<string, LecturaFuente>();

  constructor(private readonly ahora: () => Date = () => new Date()) {}

  registrar(terminal: string, contenido: string | Uint8Array, formato: FormatoPrograma): void {
    this.porTerminal.set(clave(terminal), { contenido, formato, modificadoEn: this.ahora().toISOString() });
  }

  async leer(terminal: string): Promise<LecturaFuente> {
    const l = this.porTerminal.get(clave(terminal));
    if (!l) {
      throw new ErrorFuentePrograma(
        `Aún no has subido el programa de la terminal ${clave(terminal)}. Sube el archivo del día.`,
        'sin_archivo',
      );
    }
    return l;
  }
}

export const MENSAJE_DRIVE_SIN_EJECUTOR =
  'La lectura automática desde Drive/Sheets todavía no está conectada: falta el acceso de lectura a los archivos de las terminales. Por ahora sube el archivo del día a mano.';

/** Stub de la lectura desde Drive/Sheets: siempre falla cerrado; no abre red ni lee credenciales. */
export class DriveSinEjecutor implements FuenteProgramaDespacho {
  readonly id = 'drive';
  async leer(_terminal: string): Promise<LecturaFuente> {
    throw new ErrorFuentePrograma(MENSAJE_DRIVE_SIN_EJECUTOR, 'no_configurada');
  }
}
