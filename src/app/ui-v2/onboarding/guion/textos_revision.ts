import type { PasoGuia } from '@/lib/likida/guia/tipos';

// Archivo de revisión de textos (SPEC 6.2): una fila por campo, para que Javier lo apruebe o lo cambie sin abrir código.
// Puro: recibe pasos y devuelve el markdown. El archivo del repo (`docs/guia/TEXTOS-REVISION-LIKIDA.md`) se compara con esta salida
// en una prueba para que no se desfase.

const celda = (t: string) => t.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function textosParaRevision(pasos: readonly PasoGuia[]): string {
  const filas: string[] = [];
  for (const p of pasos) {
    const campos: Array<[string, string, number]> = [['titulo', p.titulo, 48], ['texto', p.texto, 180]];
    if (p.ayuda) campos.push(['ayuda', p.ayuda, 400]);
    if (p.accion) campos.push(['accion', `${p.accion.verbo} aquí → ${p.accion.objetivo}`, 80]);
    for (const [campo, texto, limite] of campos) {
      filas.push(`| \`${p.id}.${campo}\` | ${p.pista} | ${p.pantalla} | ${campo} | ${limite} | ${celda(texto)} | ${texto.length} | ${p.aprobado ? 'aprobado' : 'borrador'} |  |  |`);
    }
  }
  return [
    '# Textos de la guía para revisión',
    '',
    'Generado desde el guion (`src/app/ui-v2/onboarding/guion/`). No se edita a mano: cambia la columna `estado` y escribe tu texto en',
    '`texto propuesto por Javier`; el constructor lo lleva al guion. Ningún paso en `borrador` se publica.',
    '',
    '| id | pista | pantalla | campo | límite | texto actual | longitud | estado | texto propuesto por Javier | notas |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...filas,
    '',
  ].join('\n');
}
