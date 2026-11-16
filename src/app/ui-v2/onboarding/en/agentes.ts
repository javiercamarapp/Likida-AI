// English (US) copy of the per-agent tour texts in `../agentes.ts` (by agent id). The agent name comes from the menu's navigation label.
export interface AgenteEn { hace: string; decide: string; limite: string }

export const AGENTES_EN: Readonly<Record<string, AgenteEn>> = {
  liquidacion: {
    hace: 'Builds each trip’s settlement: compares the advance with what is verified and delivers the breakdown by email.',
    decide: 'You sign what the agent cannot close on its own and decide which items hold the delivery.',
    limite: 'It does not pay or move money. It prepares the account; authorization belongs to a person.',
  },
  peajes: {
    hace: 'Matches the TAG or wallet statement against the expenses verified by trips.',
    decide: 'You decide which matches get claimed and upload the statement when you have it.',
    limite: 'Without the month’s file there is nothing to reconcile. It does not estimate tolls that were not crossed.',
  },
  'carta-porte': {
    hace: 'On dispatch, it asks by WhatsApp for what is missing to declare and builds the draft with its validation.',
    decide: 'A person reviews the draft before it goes out. You decide who.',
    limite: 'It prepares and validates. It never stamps.',
  },
  vigia: {
    hace: 'Serves your fleet’s customers: classifies, answers with real data and escalates what requires it.',
    decide: 'You approve the trip notices and handle what the agent escalates to a person.',
    limite: 'It only answers with data it has. Anything upsetting or unanswered goes up to a person.',
  },
  conductores: {
    hace: 'Talks to your drivers on WhatsApp: asks for trip acceptance, records milestones and collects receipts.',
    decide: 'You set how persistently it follows up, in what hours and whom it alerts when nobody answers.',
    limite: 'Without a phone number on file it cannot write to a driver.',
  },
};
