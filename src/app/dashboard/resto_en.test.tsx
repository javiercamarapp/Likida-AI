import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { crearTraductor } from '@/lib/i18n/traducir';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { resto as restoEn } from '@/lib/i18n/en/resto';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { agentes as agentesEn } from '@/lib/i18n/en/agentes';
import type { DiccionarioDe } from '@/lib/i18n/catalogo';
import { ListaLlaves } from './llaves-api/vista';
import { VistaPuestaEnMarcha } from './arranque/vista';
import { resumenMarcha } from '@/lib/likida/puesta_en_marcha';

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

// Los paneles de «resto» se pintan en inglés cuando el traductor es el en: sin una palabra en español, y con las mismas cifras.
const tEn = crearTraductor<DiccionarioDe<'resto'>>('en', restoEn, restoEs).t;
const tEs = crearTraductor<DiccionarioDe<'resto'>>('es', restoEs, restoEs).t;

describe('«resto» en inglés', () => {
  it('las llaves de API sin llaves dicen lo mismo en cada idioma, sin mezclar', () => {
    const accion = (async () => null) as never;
    const en = renderToStaticMarkup(<ListaLlaves llaves={[]} revocarLlave={accion} t={tEn} />);
    const es = renderToStaticMarkup(<ListaLlaves llaves={[]} revocarLlave={accion} t={tEs} />);
    expect(en).toContain('No keys issued yet');
    expect(en).not.toContain('Aún no hay llaves');
    expect(es).toContain('Aún no hay llaves emitidas');
  });

  it('la puesta en marcha traduce sus grupos y no deja los rótulos en español', () => {
    const html = renderToStaticMarkup(<VistaPuestaEnMarcha pasos={[]} resumen={resumenMarcha([])} puedeAdministrar={false} hrefAutomatizacion={{}} t={tEn} />);
    expect(html).toContain('Getting started');
    expect(html).toContain('Your fleet and its account');
    expect(html).toContain('Your people and your trucks');
  });

  it('el diccionario de agentes en inglés cubre las claves nuevas con las mismas variables', () => {
    const t = crearTraductor<DiccionarioDe<'agentes'>>('en', agentesEn, agentesEs);
    expect(t.t('rest.n_emision_con_uuid.otros', { n: 3 })).toBe('3 issuances with UUID');
    expect(t.t('rest.n_emision_con_uuid.uno', { n: 1 })).toBe('1 issuance with UUID');
  });
});
