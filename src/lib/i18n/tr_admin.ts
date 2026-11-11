import { crearTraductor } from './traducir';
import type { DiccionarioDe } from './catalogo';
import type { TrDe } from './tr_tipos';
import { admin_inicio } from './es/admin_inicio';
import { admin_agentes } from './es/admin_agentes';

// Traductores en español de los namespaces de /admin, para componentes de servidor SÍNCRONOS: la página (async) arma el traductor con
// `getT('admin_x')` y lo baja por la prop `t`; sin ella (pruebas de render, arneses) el componente habla español, igual que antes.
export const trAdminInicioEs: TrDe<'admin_inicio'> = crearTraductor<DiccionarioDe<'admin_inicio'>>('es', admin_inicio, admin_inicio).t;
export const trAdminAgentesEs: TrDe<'admin_agentes'> = crearTraductor<DiccionarioDe<'admin_agentes'>>('es', admin_agentes, admin_agentes).t;
