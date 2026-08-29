// ═══════════════════════════════════════════════════════════════════════════
// La forma de UNA herramienta MCP de Likida.
//
// Cada herramienta declara su ÁREA (`operacion` | `dinero` | `administracion`)
// y el despachador la exige contra la credencial ANTES de ejecutar — el mismo
// reparto que las rutas de /v1 piden en `abrir()`. Una herramienta sin área
// no compila: el default sería el día en que alguien agregue una herramienta
// de dinero y se le olvide acotarla.
//
// Todas las herramientas de este servidor son de SOLO LECTURA. La regla de la
// casa —el agente prepara, el humano firma— hace que cerrar una liquidación,
// timbrar o mandar un WhatsApp NO tengan herramienta aquí: eso se firma en el
// panel. Si un día se agrega una escritura, no basta con quitar el candado:
// hay que construir el camino de preparar-y-constancia.
// ═══════════════════════════════════════════════════════════════════════════

import type { z } from 'zod';
import type { Area } from '@/lib/auth/visibilidad';

export interface ResultadoHerramienta {
  /** Lo que el modelo lee. En español, con cifras ya formateadas. */
  texto: string;
  /** La misma respuesta en datos, para `structuredContent`. */
  estructurado?: Record<string, unknown>;
}

export interface Herramienta<T> {
  /** snake_case, estable: es el contrato con el cliente. */
  nombre: string;
  titulo: string;
  /**
   * La lee un MODELO DE TERCEROS: describe qué contesta y qué no, sin
   * estructura interna (ni tablas, ni columnas) y sin invitar a nada que la
   * herramienta no haga.
   */
  descripcion: string;
  area: Area;
  esquema: z.ZodType<T>;
  ejecutar: (tenantId: string, args: T, contexto: ContextoHerramienta) => Promise<ResultadoHerramienta>;
}

export interface ContextoHerramienta {
  /** ¿La credencial alcanza también esta otra área? Para herramientas que
   *  enseñan una sección extra solo si el que pregunta puede verla. */
  alcanza: (area: Area) => boolean;
}
