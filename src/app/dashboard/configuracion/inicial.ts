// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · ARQ-3 (ALTO, NUEVO) — cómo se prellena esta pantalla, en un
// módulo PURO para poder probarlo sin base ni React.
//
// El defecto: el textarea de cuentas se prellenaba con
// `formatearCuentas(config.catalogoCuentas)`, y `config` viene de `getConfig()`,
// que FUSIONA `DEMO_CONFIG`. Una flota que nunca declaró catálogo veía
// `diesel=600-001 · caseta=600-002 …` sin una sola marca de que esas cuentas no
// eran suyas, mientras `/api/export/poliza` —que lee el override crudo— le
// devolvía 409 «esta flota todavía no declaró su catálogo». Dos pantallas, dos
// verdades. Y peor: guardar CUALQUIER ajuste operativo (subir el precio del
// diésel) reenviaba ese textarea y escribía las cuentas demo como DECLARADAS,
// que es lo que el siguiente export asienta en el ERP del cliente.
//
// Aquí el catálogo se prellena SOLO con lo que la flota declaró
// (`cuentasDeclaradas`, `contabilidad/catalogo.ts` — el lector correcto). Lo
// que no declaró, no se enseña: el textarea va vacío y la pantalla lo dice.
// La forma correcta ya existía a dos carpetas: `politicas/page.tsx` distingue
// «propia» de «heredada».
// ═══════════════════════════════════════════════════════════════════════════
import { formatearCuentas, type AjustesCrudos } from '@/lib/likida/ajustes_operativos';

/** Lo que la pantalla sabe del catálogo de ESTA flota. */
export type EstadoCatalogo =
  /** Lo declaró: el textarea trae lo suyo. */
  | 'declarado'
  /** No ha declarado ninguna cuenta: textarea vacío, y se dice. */
  | 'sin_declarar'
  /** No se pudo leer. NO es «vacío»: se avisa antes de que alguien guarde. */
  | 'ilegible';

/** El pedacito de `ConfigTenant` que esta pantalla necesita. */
export interface ConfigParaAjustes {
  tabulador: {
    rendimientoPorDefecto: number;
    factorCarga: number;
    precioDieselPorDefecto: number;
    umbralDesviacion: number;
  };
  salida: string;
}

/**
 * Los valores con los que arranca el formulario.
 *
 * `cuentasDeclaradas` es el override CRUDO del tenant (`null` = no declaró
 * nada, o no se pudo leer). Nunca se cae a `config.catalogoCuentas`: ahí vive
 * la demo fusionada.
 */
export function ajustesIniciales(
  config: ConfigParaAjustes | null,
  cuentasDeclaradas: Record<string, string> | null,
): AjustesCrudos {
  const cuentas = cuentasDeclaradas ? formatearCuentas(cuentasDeclaradas) : '';
  if (!config) {
    return {
      rendimientoPorDefecto: '', factorCarga: '', precioDieselPorDefecto: '',
      umbralDesviacionPct: '', salida: 'csv', cuentas,
    };
  }
  return {
    rendimientoPorDefecto: String(config.tabulador.rendimientoPorDefecto),
    factorCarga: String(config.tabulador.factorCarga),
    precioDieselPorDefecto: String(config.tabulador.precioDieselPorDefecto),
    // De fracción a porcentaje: el motor guarda 0.15, la persona lee 15.
    umbralDesviacionPct: String(Math.round(config.tabulador.umbralDesviacion * 10000) / 100),
    salida: config.salida,
    cuentas,
  };
}
