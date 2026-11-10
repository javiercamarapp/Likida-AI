// Fuera de page.tsx: una page solo puede exportar default/metadata/dynamic… (next build lo rechaza).
/** Quién, sin correos: un nombre, «Sistema» (una tarea programada o un escritor viejo sin firma) o «Persona sin nombre». */
export function quienDe(actor: string | null): string {
  if (actor === null || actor.trim() === '') return 'Sistema';
  return actor.includes('@') ? 'Persona sin nombre' : actor;
}
