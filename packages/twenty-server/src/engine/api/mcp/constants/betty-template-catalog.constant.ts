export type BettyTemplate = {
  id: string;
  applicationUniversalIdentifier: string;
  title: string;
  description: { es: string; en: string };
  entryPoints: string[];
  minimumSetup: string;
};

export const BETTY_TEMPLATES: BettyTemplate[] = [
  {
    id: 'finanzas',
    applicationUniversalIdentifier: 'e591c455-b58d-471b-9b56-99d444b33c0c',
    title: 'Finanzas personales y familiares',
    description: {
      es: 'Cuentas, movimientos, presupuesto y previsión de caja para llevar las finanzas de una persona o una familia, incluso desde la foto de un ticket.',
      en: 'Accounts, transactions, budget and cash forecast to run personal or family finances, even from a photo of a receipt.',
    },
    entryPoints: [
      'Registrar mi primer movimiento (puede ser la foto de un ticket)',
      'Configurar mis cuentas y el presupuesto',
    ],
    minimumSetup:
      'moneda principal y una cuenta con su saldo inicial y su fecha de corte',
  },
];

export const findBettyTemplate = (templateId: string) =>
  BETTY_TEMPLATES.find((template) => template.id === templateId);
