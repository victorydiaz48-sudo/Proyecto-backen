import type { Locale } from '@autocontent/shared';
import type { BodyType, MissingField, Segment } from './entities/vehicle-analysis.js';

/** The dealership module's own strings — never merged into `@autocontent/shared`'s core `messages()`. */
export interface DealershipMessages {
  notAVehicle: string;
  multipleVehicles: string;
  unclearPhoto: string;
  labels: { bodyType: string; segment: string };
  bodyTypes: Record<BodyType, string>;
  segments: Record<Segment, string>;
  missingFields: Record<MissingField, string>;
}

const es: DealershipMessages = {
  notAVehicle: '🤔 No veo ningún vehículo en esta foto. Envía una foto del coche, por favor.',
  multipleVehicles: '🚗🚗 Veo varios vehículos. Envía una foto con un solo coche, por favor.',
  unclearPhoto: '📷 No puedo ver bien el vehículo. Prueba con una foto más clara, con buena luz y el coche completo.',
  labels: { bodyType: 'Carrocería', segment: 'Segmento' },
  bodyTypes: {
    sedan: 'Sedán',
    hatchback: 'Hatchback',
    suv: 'SUV',
    crossover: 'Crossover',
    pickup: 'Pickup',
    coupe: 'Coupé',
    convertible: 'Descapotable',
    wagon: 'Familiar',
    van: 'Furgoneta',
    other: 'Otro',
  },
  segments: {
    economy: 'Económico',
    'mid-range': 'Gama media',
    premium: 'Premium',
    luxury: 'Lujo',
    sport: 'Deportivo',
    utility: 'Utilitario',
  },
  missingFields: {
    make: 'marca',
    model: 'modelo',
    version: 'versión',
    year: 'año',
    color: 'color',
    body_type: 'carrocería',
    estimated_segment: 'segmento',
    price: 'precio',
    mileage: 'kilometraje',
    location: 'ciudad',
    contact: 'contacto',
    financing: 'financiación (opcional)',
  },
};

const pt: DealershipMessages = {
  notAVehicle: '🤔 Não vejo nenhum veículo nesta foto. Envie uma foto do carro, por favor.',
  multipleVehicles: '🚗🚗 Vejo vários veículos. Envie uma foto com um só carro, por favor.',
  unclearPhoto: '📷 Não consigo ver bem o veículo. Tente uma foto mais nítida, com boa luz e o carro inteiro.',
  labels: { bodyType: 'Carroceria', segment: 'Segmento' },
  bodyTypes: {
    sedan: 'Sedã',
    hatchback: 'Hatch',
    suv: 'SUV',
    crossover: 'Crossover',
    pickup: 'Picape',
    coupe: 'Cupê',
    convertible: 'Conversível',
    wagon: 'Perua',
    van: 'Van',
    other: 'Outro',
  },
  segments: {
    economy: 'Econômico',
    'mid-range': 'Intermediário',
    premium: 'Premium',
    luxury: 'Luxo',
    sport: 'Esportivo',
    utility: 'Utilitário',
  },
  missingFields: {
    make: 'marca',
    model: 'modelo',
    version: 'versão',
    year: 'ano',
    color: 'cor',
    body_type: 'carroceria',
    estimated_segment: 'segmento',
    price: 'preço',
    mileage: 'quilometragem',
    location: 'cidade',
    contact: 'contato',
    financing: 'financiamento (opcional)',
  },
};

const en: DealershipMessages = {
  notAVehicle: '🤔 I can’t see a vehicle in this photo. Please send a photo of the car.',
  multipleVehicles: '🚗🚗 I can see several vehicles. Please send a photo with just one car.',
  unclearPhoto: '📷 I can’t see the vehicle clearly. Try a sharper photo, with good light and the whole car in view.',
  labels: { bodyType: 'Body', segment: 'Segment' },
  bodyTypes: {
    sedan: 'Sedan',
    hatchback: 'Hatchback',
    suv: 'SUV',
    crossover: 'Crossover',
    pickup: 'Pickup',
    coupe: 'Coupe',
    convertible: 'Convertible',
    wagon: 'Wagon',
    van: 'Van',
    other: 'Other',
  },
  segments: {
    economy: 'Economy',
    'mid-range': 'Mid-range',
    premium: 'Premium',
    luxury: 'Luxury',
    sport: 'Sport',
    utility: 'Utility',
  },
  missingFields: {
    make: 'make',
    model: 'model',
    version: 'trim',
    year: 'year',
    color: 'color',
    body_type: 'body type',
    estimated_segment: 'segment',
    price: 'price',
    mileage: 'mileage',
    location: 'city',
    contact: 'contact',
    financing: 'financing (optional)',
  },
};

const DEALERSHIP_MESSAGES: Record<Locale, DealershipMessages> = { es, pt, en };

export function dealershipMessages(locale: Locale): DealershipMessages {
  return DEALERSHIP_MESSAGES[locale];
}
