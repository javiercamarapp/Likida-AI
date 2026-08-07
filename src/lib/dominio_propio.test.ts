import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sinComentarios, fuentesDeProduccion } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// 31-jul-2026 · SE ESTABA IMPRIMIENDO UN DOMINIO QUE NO ES NUESTRO.
//
// `cuadra.mx` aparecía en tres sitios, y uno de ellos es papel que se archiva:
//
//   · el PIE DE CADA PDF DE LIQUIDACIÓN — el documento que el contralor guarda
//     y que puede ver un tercero,
//   · la cabecera `HTTP-Referer` hacia OpenRouter,
//   · y la liga del aviso de privacidad del seed, que la escribí yo dos commits
//     antes creyendo que arreglaba algo.
//
// `cuadra.mx` está PARKEADO: responde `200` a cualquier ruta con un redirect a
// `/lander`, o sea su página de "en venta". Por eso pasaba desapercibido —
// comprobarlo con `curl -o /dev/null -w %{http_code}` daba 200 y se leía como
// "el dominio funciona". Lo que lo delató fue que `/api/webhook/whatsapp`
// devolviera 404 ahí y 403 en `likida.ai`: la ruta existe en uno y no en el
// otro, así que no era la misma app.
//
// El daño de un dominio parkeado es peor que el de uno muerto. Un NXDOMAIN no
// abre nada; éste le enseña al operador el anuncio de un desconocido desde el
// enlace que su aviso de privacidad presenta como el de su empresa.
//
// EN EL FUENTE NO SE VE. `right('cuadra.mx', …)` se lee como una marca. Solo se
// ve saliendo a la red, y por eso la prueba es una lista y no una inspección.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dominios que NO controlamos y que por eso no pueden viajar en nada que salga
 * de aquí. La lista crece cuando se descubra otro; no pretende ser exhaustiva.
 */
const AJENOS = ['cuadra.mx', 'flotademo.mx'];

const FUENTES = fuentesDeProduccion('src');

describe('nada nuestro nombra un dominio ajeno', () => {
  it.each(AJENOS)('`%s` no aparece en el código de producción', (dominio) => {
    // Sobre el CÓDIGO: los comentarios de arriba y los de `pdf.ts` NOMBRAN el
    // dominio para contar por qué se quitó, y esa explicación es justo lo que
    // impide que alguien lo vuelva a poner.
    const culpables = FUENTES.filter((f) =>
      sinComentarios(readFileSync(f, 'utf8')).includes(dominio),
    );
    expect(
      culpables,
      `${dominio} no es nuestro. Si aparece en el PDF, en un correo o en una liga ` +
      `del aviso, el cliente termina en la página de otro.`,
    ).toEqual([]);
  });

  it('tampoco en el seed, que es de donde salió la liga del aviso', () => {
    const seed = readFileSync('supabase/seed.sql', 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const d of AJENOS) expect(seed).not.toContain(d);
  });
});

describe('el dominio propio sale de un solo sitio', () => {
  it('el pie del PDF y el referer usan `likida.ai`', () => {
    // El pie es lo único de esta lista que el CLIENTE lee en papel.
    const pdf = readFileSync('src/lib/likida/liquidacion/pdf.ts', 'utf8');
    expect(pdf).toContain("right('likida.ai'");
    const or = readFileSync('src/lib/llm/openrouter.ts', 'utf8');
    expect(or).toContain('https://likida.ai');
  });

  it('el referer prefiere `NEXT_PUBLIC_APP_URL` sobre la constante', () => {
    // Si el software se muda a `app.likida.ai`, la variable manda y el código
    // no hay que tocarlo. La constante es solo el suelo.
    const or = sinComentarios(readFileSync('src/lib/llm/openrouter.ts', 'utf8'));
    expect(or).toMatch(/process\.env\.NEXT_PUBLIC_APP_URL \|\| 'https:\/\/likida\.ai'/);
  });
});
