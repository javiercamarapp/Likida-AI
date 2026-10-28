// ═══════════════════════════════════════════════════════════════════════════
// DESTINATARIOS DEL DESGLOSE POR CORREO (T-A1-14) — resolución PURA.
//
// Dado el operador, su coordinador y la configuración de entrega, devuelve a quién se manda (un correo por destino,
// nunca To/Cc múltiple: un rebote con varios destinatarios en un mismo correo es ambiguo) y qué no se pudo resolver.
//
//   · Roles: operador, coordinador, rh (hasta 3 correos fijos), archivo (buzón de «Enviados») y revisor (0933: el «modo primer mes»,
//     un revisor por departamento; se resuelve APARTE con `resolverRevisores`, porque también recibe los desgloses retenidos).
//   · Se normaliza (trim + minúsculas) y se DEDUPLICA por correo. Si un mismo correo cae en dos roles se conserva el
//     más específico: operador > coordinador > rh > archivo.
//   · Un operador sin correo (o con el correo rebotado) NO recibe, pero coordinador/RH/archivo SÍ: así el desglose
//     llega aunque «el operador no me da mi desglose». Eso se informa en `faltantes` para abrir la excepción.
//   · Sin I/O y sin cifras: aquí no hay importes, solo direcciones.
// ═══════════════════════════════════════════════════════════════════════════

export const ROLES_DESTINATARIO = ['operador', 'coordinador', 'rh', 'archivo', 'revisor'] as const;
export type RolDestinatario = (typeof ROLES_DESTINATARIO)[number];

export type MotivoFaltante = 'operador_sin_correo' | 'correo_rebotado' | 'coordinador_sin_asignar';

export interface ConfigDestinatarios {
  rhCorreos: readonly string[];
  archivoCorreo: string | null;
  enviaCoordinador: boolean;
  enviaRh: boolean;
}

export interface EntradaDestinatarios {
  operador: { correo: string | null; rebotadoEn: string | Date | null };
  coordinador: { correo: string | null; activo: boolean } | null;
  config: ConfigDestinatarios;
}

export interface Destino {
  rol: RolDestinatario;
  correo: string;
}

export interface Faltante {
  rol: RolDestinatario;
  motivo: MotivoFaltante;
}

export interface DestinatariosResueltos {
  destinos: Destino[];
  faltantes: Faltante[];
}

const normalizar = (c: string | null | undefined): string | null => {
  const t = (c ?? '').trim().toLowerCase();
  return t === '' ? null : t;
};

export function resolverDestinatarios(e: EntradaDestinatarios): DestinatariosResueltos {
  const destinos: Destino[] = [];
  const faltantes: Faltante[] = [];
  const vistos = new Set<string>();
  const agregar = (rol: RolDestinatario, correo: string) => {
    if (vistos.has(correo)) return; // el primero (más específico) gana
    vistos.add(correo);
    destinos.push({ rol, correo });
  };

  // 1) operador
  const op = normalizar(e.operador.correo);
  if (op === null) faltantes.push({ rol: 'operador', motivo: 'operador_sin_correo' });
  else if (e.operador.rebotadoEn) faltantes.push({ rol: 'operador', motivo: 'correo_rebotado' });
  else agregar('operador', op);

  // 2) coordinador
  if (e.config.enviaCoordinador) {
    const co = e.coordinador && e.coordinador.activo ? normalizar(e.coordinador.correo) : null;
    if (co === null) faltantes.push({ rol: 'coordinador', motivo: 'coordinador_sin_asignar' });
    else agregar('coordinador', co);
  }

  // 3) RH fijo (uno o varios correos configurados)
  if (e.config.enviaRh) {
    for (const c of e.config.rhCorreos) {
      const rh = normalizar(c);
      if (rh !== null) agregar('rh', rh);
    }
  }

  // 4) archivo («Enviados»)
  const ar = normalizar(e.config.archivoCorreo);
  if (ar !== null) agregar('archivo', ar);

  return { destinos, faltantes };
}

/**
 * Los revisores del «modo primer mes» (0933): un correo por departamento (nómina, RH…). PURA. Se normaliza y se deduplica por
 * correo; `yaVistos` son los correos que ya reciben ESTE desglose por otro rol (operador, coordinador, RH, archivo): ese buzón ya
 * tiene el desglose y no se le manda dos veces. Sin modo vigente (`vigente=false`) o sin revisores, lista vacía.
 */
export function resolverRevisores(
  revisores: ReadonlyArray<{ departamento: string; correo: string }>, vigente: boolean, yaVistos: ReadonlySet<string> = new Set(),
): Destino[] {
  if (!vigente) return [];
  const salida: Destino[] = [];
  const vistos = new Set(yaVistos);
  for (const r of revisores) {
    const correo = normalizar(r.correo);
    if (correo === null || vistos.has(correo)) continue;
    vistos.add(correo);
    salida.push({ rol: 'revisor', correo });
  }
  return salida;
}
