// English (US) copy of `../pistas.ts` (contextual hints). Same route keys; only title and text. Built on the server, like the Spanish one.
export interface PistaEn { titulo: string; texto: string }

export const PISTAS_EN: Readonly<Record<string, PistaEn>> = {
  '/dashboard/[id]': { titulo: 'A settlement’s detail', texto: 'Advance, verified and difference, with the basis of each figure. Review, adjust or reject before signing.' },
  '/dashboard/integraciones': { titulo: 'This screen was merged into Connections', texto: 'What you are looking for now lives in Connections. This address still opens so saved links do not break.' },
  '/dashboard/carta-porte/borrador/[id]': { titulo: 'The Carta Porte draft', texto: 'Review what is missing and who declares it. The draft is validated before stamping; nothing is issued here.' },
  '/dashboard/agentes/liquidacion/formato': { titulo: 'Your settlement format', texto: 'Likida takes the payment data and sends it to the driver in the format you already use.' },
  '/dashboard/agentes/liquidacion/configuracion': { titulo: 'How the statement is delivered', texto: 'Who receives it, how it looks and which items hold the delivery.' },
  '/dashboard/agentes/peajes/configuracion': { titulo: 'Reconciler settings', texto: 'Mailbox, inputs and mappings the agent uses to match the statement against the trips.' },
  '/dashboard/agentes/peajes/reclamacion': { titulo: 'Claim report', texto: 'The candidate matches for a claim, the monthly close and the follow-up of each claim.' },
  '/dashboard/agentes/carta-porte/catalogo': { titulo: 'Customer catalog', texto: 'What the agent learns once about each customer: products, shippers, consignees and their internal number.' },
  '/dashboard/agentes/carta-porte/referencia': { titulo: 'Customer reference', texto: 'Some customers require their reference to pay. Here you see the loaded trips that lack it.' },
  '/dashboard/agentes/carta-porte/configuracion': { titulo: 'Output settings', texto: 'How the template goes out to the customer’s system and what the agent does when something is missing.' },
  '/dashboard/agentes/vigia/historial': { titulo: 'Customer groups and history', texto: 'Mark the WhatsApp groups of your critical customers and upload the exported chat to see what they ask most.' },
  '/dashboard/agentes/vigia/programa': { titulo: 'Dispatch schedule', texto: 'Upload the schedule file so the agent can notify your customers.' },
  '/dashboard/agentes/vigia/importacion': { titulo: 'Import status', texto: 'Each trip’s status is derived from the file you upload. If the file does not say it, neither does this screen.' },
  '/dashboard/agentes/vigia/sin-atender': { titulo: 'Unattended conversations', texto: 'What your customers asked and nobody answered, per the exported chats you uploaded. Not real time.' },
  '/dashboard/agentes/vigia/bandeja': { titulo: 'Attention inbox', texto: 'Your customers\' chats by priority: who answers them, how long they have gone unanswered and the full thread.' },
  '/dashboard/agentes/vigia/avisos': { titulo: 'Trip notices', texto: 'The agent drafts the notices for your customers. Confirm, edit or discard them before they go out.' },
  '/dashboard/agentes/conductores/sitios': { titulo: 'Site catalog', texto: 'Customers, plants and docks with their center and radius. No coordinate is computed or invented.' },
  '/dashboard/agentes/conductores/conversaciones': { titulo: 'Driver conversations', texto: 'The chat with each driver: trip notice, replies with their time, how each report was checked against location, and who handles escalations.' },
  '/dashboard/agentes/conductores/estadias': { titulo: 'Dock detention', texto: 'The time between arrival and departure for each load or unload, with the exact time of the driver’s message.' },
  '/dashboard/agentes/conductores/configuracion': { titulo: 'Agent settings', texto: 'When and how persistently the agent follows up with your drivers, in what hours and whom it alerts if nobody answers.' },
};
