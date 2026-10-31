/* eslint-disable security/detect-non-literal-fs-filename -- lee fuentes del repo con rutas propias */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INFO, type InfoTexto } from './info-catalogo';

// ═══════════════════════════════════════════════════════════════════════════
// ATADURA DE CIFRAS (L4): los textos de ⓘ nombran ventanas y topes que el código fija en constantes. El catálogo no puede importar esas
// constantes (viven en módulos de servidor y la ⓘ es un componente de cliente), así que esta prueba las ata: lee el VALOR ACTUAL de
// cada constante en su archivo y exige que cada clave listada lo diga con esa cifra. Si alguien cambia 45 a 60 días en el código, esta
// prueba falla hasta que se corrija el texto. Una constante o una clave que desaparece también falla (no se puede «olvidar» la atadura).
// ═══════════════════════════════════════════════════════════════════════════

const SRC = join(process.cwd(), 'src');
const LIGAS: Array<{ archivo: string; constante: string; claves: string[] }> = [
  { archivo: 'lib/likida/auditor_cobranza.ts', constante: 'VENTANA_AUDITOR_DIAS', claves: ['facturacion.auditor', 'facturacion.dinero_dormido', 'facturacion.facturado_de_menos', 'facturacion.margen_medido'] },
  { archivo: 'lib/likida/facturacion/pendientes.ts', constante: 'DIAS_VENTANA_POR_FACTURAR', claves: ['facturas.por_facturar', 'facturas.monto_sin_factura', 'facturas.vencidos'] },
  { archivo: 'lib/likida/carta_porte_docs/metricas.ts', constante: 'MINUTOS_CAPTURA_MANUAL_EMBARQUE', claves: ['carta_porte_docs.tiempo_ahorrado'] },
  { archivo: 'lib/likida/conversaciones.ts', constante: 'TOPE_HILOS', claves: ['conversaciones.mensajes'] },
  { archivo: 'app/dashboard/arco/vencimiento.ts', constante: 'DIAS_VENCE_PRONTO', claves: ['arco.vencen_pronto'] },
  { archivo: 'app/dashboard/carta-porte/documentos/page.tsx', constante: 'DIAS_VENTANA', claves: ['carta_porte_docs.recibidos', 'carta_porte_docs.aprobados'] },
  { archivo: 'app/dashboard/agentes/facturas/vista.tsx', constante: 'MAX_TE_TOCA', claves: ['facturas.te_toca'] },
  { archivo: 'app/dashboard/agentes/facturas/vista.tsx', constante: 'MAX_MINI', claves: ['facturas.hizo_solo', 'facturas.maquina'] },
  { archivo: 'lib/likida/agentes/cobranza_gasto.ts', constante: 'DIAS_EFECTIVIDAD', claves: ['cobranza.gasto_avisos', 'cobranza.gasto_efectividad', 'cobranza.gasto_efectividad_desglose'] },
  { archivo: 'app/dashboard/agentes/cobranza/seccion-por-gasto.tsx', constante: 'MAX_FILAS', claves: ['cobranza.gasto_faltantes'] },
];

const textoDe = (t: InfoTexto) => [t.queEs, t.comoSeCalcula, t.fuente, t.queHacer ?? ''].join(' ');

describe('ⓘ: las cifras de ventanas y topes siguen a su constante', () => {
  for (const { archivo, constante, claves } of LIGAS) {
    it(`${constante} (${archivo}) aparece con su valor actual en ${claves.join(', ')}`, () => {
      const fuente = readFileSync(join(SRC, archivo), 'utf8');
      const m = new RegExp(`\\b${constante}\\s*=\\s*([0-9_]+)`).exec(fuente);
      expect(m, `no encuentro ${constante} en ${archivo}`).not.toBeNull();
      const valor = String(Number((m as RegExpExecArray)[1].replace(/_/g, '')));
      for (const k of claves) {
        const t = (INFO as Record<string, InfoTexto | undefined>)[k];
        expect(t, `falta la clave ${k}`).toBeDefined();
        expect(textoDe(t as InfoTexto), `${k} debe decir ${valor} (${constante})`).toMatch(new RegExp(`(^|[^0-9.,])${valor}([^0-9]|$)`));
      }
    });
  }
});
