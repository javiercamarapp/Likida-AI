// Texto honesto de «preparar envío al TMS» (F2, superficie honesta). Hoy ninguna flota real tiene adaptador del sistema del
// cliente (tms_puerto.ts, A37-A3-02): prometer «el sistema lo enviará» sería falso. Módulo puro, sin imports.

export function mensajeEnvioPreparado(creado: boolean, sinConexion: boolean): string {
  if (sinConexion) {
    if (!creado) return 'El envío ya estaba preparado, pero el envío automático al sistema del cliente está por conectar: descarga la plantilla y súbela a mano.';
    return 'Envío registrado, pero el envío automático al sistema del cliente todavía no está conectado (por conectar). Descarga la plantilla y súbela a mano.';
  }
  return creado ? 'Envío preparado: el sistema lo enviará al TMS.' : 'El envío ya estaba preparado.';
}
