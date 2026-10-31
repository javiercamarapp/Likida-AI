/** Une clases ignorando lo falsy. Sin dependencias. */
export function cx(...partes: Array<string | false | null | undefined>): string {
  return partes.filter(Boolean).join(' ');
}
