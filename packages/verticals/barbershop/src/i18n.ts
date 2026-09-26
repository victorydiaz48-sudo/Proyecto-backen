import type { Locale } from '@autocontent/shared';
import type { Hairstyle, MissingField } from './entities/haircut-analysis.js';

export interface BarbershopMessages {
  notAHaircut: string;
  unclearHaircutPhoto: string;
  labels: { style: string; color: string; confidence: string; missing: string; unidentified: string };
  hairstyles: Record<Hairstyle, string>;
  missingFields: Record<MissingField, string>;
}

const es: BarbershopMessages = {
  notAHaircut: '🤔 No veo un corte de cabello en esta foto. Envía una foto del resultado, por favor.',
  unclearHaircutPhoto: '📷 No puedo ver bien el corte. Prueba con una foto más clara.',
  labels: { style: 'Estilo', color: 'Color', confidence: 'Confianza', missing: 'Me falta', unidentified: 'Corte no identificado' },
  hairstyles: { 'buzz-cut': 'Buzz cut', fade: 'Fade', afro: 'Afro', bob: 'Bob', pixie: 'Pixie', undercut: 'Undercut', other: 'Otro' },
  missingFields: { style: 'estilo', color: 'color', price: 'precio', stylistName: 'estilista' },
};

const pt: BarbershopMessages = {
  notAHaircut: '🤔 Não vejo um corte de cabelo nesta foto. Envie uma foto do resultado, por favor.',
  unclearHaircutPhoto: '📷 Não consigo ver bem o corte. Tente uma foto mais nítida.',
  labels: { style: 'Estilo', color: 'Cor', confidence: 'Confiança', missing: 'Falta', unidentified: 'Corte não identificado' },
  hairstyles: { 'buzz-cut': 'Buzz cut', fade: 'Fade', afro: 'Afro', bob: 'Bob', pixie: 'Pixie', undercut: 'Undercut', other: 'Outro' },
  missingFields: { style: 'estilo', color: 'cor', price: 'preço', stylistName: 'estilista' },
};

const en: BarbershopMessages = {
  notAHaircut: '🤔 I can’t see a haircut in this photo. Please send a photo of the result.',
  unclearHaircutPhoto: '📷 I can’t see the haircut clearly. Try a sharper photo.',
  labels: { style: 'Style', color: 'Color', confidence: 'Confidence', missing: 'Still needed', unidentified: 'Haircut not identified' },
  hairstyles: { 'buzz-cut': 'Buzz cut', fade: 'Fade', afro: 'Afro', bob: 'Bob', pixie: 'Pixie', undercut: 'Undercut', other: 'Other' },
  missingFields: { style: 'style', color: 'color', price: 'price', stylistName: 'stylist' },
};

const BARBERSHOP_MESSAGES: Record<Locale, BarbershopMessages> = { es, pt, en };

export function barbershopMessages(locale: Locale): BarbershopMessages {
  return BARBERSHOP_MESSAGES[locale];
}
