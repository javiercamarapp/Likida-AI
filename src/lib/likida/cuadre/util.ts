export function strip_accents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
