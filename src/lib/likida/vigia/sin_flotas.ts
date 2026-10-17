// El Vigía (A4) está en «Próximamente» para las flotas con perfil `cinco_agentes` (fase 1): ninguna pasada del barrido
// (escalamiento, correos de respaldo, atorados, ciclos muertos, avisos) las mira. Filtro puro; el cron lee la lista de
// flotas con perfil (`tenantsConPerfilASaltar`) y la pasa como `saltar`. Sin flotas a saltar devuelve la misma lista.
export function sinTenantsDePerfil<T>(filas: readonly T[], saltar: ReadonlySet<string>, idDe: (f: T) => string): T[] {
  if (saltar.size === 0) return [...filas];
  return filas.filter((f) => !saltar.has(idDe(f)));
}
