// ═══════════════════════════════════════════════════════════════════════════
// DESTINATARIOS DEL DESGLOSE POR CORREO (T-A1-14) — resolución PURA.
//
// Dado el operador, su coordinador y la configuración de entrega, devuelve a quién se manda (un correo por destino,
// nunca To/Cc múltiple: un rebote con varios destinatarios en un mismo correo es ambiguo) y qué no se pudo resolver.
//
//   · Roles: operador, coordinador, rh (hasta 3 correos fijos), archivo (buzón de «Enviados»).
//   · Se normaliza (trim + minúsculas) y se DEDUPLICA por correo. Si un mismo correo cae en dos roles se conserva el
//     más específico: operador > coordinador > rh > archivo.
//   · Un operador sin correo (o con el correo rebotado) NO recibe, pero coordinador/RH/archivo SÍ: así el desglose
//     llega aunque «el operador no me da mi desglose». Eso se informa en `faltantes` para abrir la excepción.
//   · Sin I/O y sin cifras: aquí no hay importes, solo direcciones.
// ═══════════════════════════════════════════════════════════════════════════

export const ROLES_DESTINATARIO = ['operador', 'coordinador', 'rh', 'archivo'] as const;
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
