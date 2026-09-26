import type { BodyType, FieldSource, MissingField, Segment } from './vehicle.js';

export const LOCALES = ['es', 'pt', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

export interface Messages {
  analyzing: string;
  welcome: string;
  help: string;
  sendPhoto: string;
  unsupportedFile: string;
  imageTooLarge: (maxMb: number) => string;
  imageTooSmall: (minPx: number) => string;
  imageTooBigDimensions: (maxPx: number) => string;
  imageInvalid: string;
  visionNotConfigured: string;
  notAVehicle: string;
  multipleVehicles: string;
  unclearPhoto: string;
  jobFailed: string;
  access: {
    needInvite: string;
    inviteInvalid: string;
    alreadyClaimed: string;
    linked: (role: string) => string;
    alreadyLinked: string;
    blocked: string;
    suspended: string;
    notConfigured: string;
    dailyLimit: string;
    monthlyLimit: string;
    inviteForbidden: string;
    inviteUsage: string;
    inviteCreated: (link: string, role: string, hours: number) => string;
  };
  roles: Record<'OWNER' | 'ADMIN' | 'EDITOR' | 'OPERATOR', string>;
  mockNotice: string;
  captionIntro: string;
  labels: {
    version: string;
    year: string;
    approx: string;
    color: string;
    bodyType: string;
    segment: string;
    confidence: string;
    features: string;
    missing: string;
    unidentified: string;
  };
  sources: Record<FieldSource, string>;
  bodyTypes: Record<BodyType, string>;
  segments: Record<Segment, string>;
  missingFields: Record<MissingField, string>;
}

const es: Messages = {
  analyzing: '🚗 Analizando tu vehículo…',
  welcome:
    '👋 ¡Hola! Envíame <b>una foto</b> de un vehículo y generaré contenido de marketing listo para publicar.',
  help:
    '📸 Envía una foto clara del vehículo (JPG, PNG o WebP).\n' +
    'Identifico marca, modelo, color y carrocería, y te devuelvo un texto para redes.\n\n' +
    'Comandos:\n/start – bienvenida\n/help – esta ayuda\n/invite – invitar a alguien (propietario/administrador)',
  sendPhoto: '📸 Envíame una foto del vehículo para empezar.',
  unsupportedFile: '⚠️ Solo acepto imágenes JPG, PNG o WebP.',
  imageTooLarge: (mb) => `⚠️ La imagen es demasiado grande. Máximo ${mb} MB.`,
  imageTooSmall: (px) => `⚠️ La imagen es demasiado pequeña. El lado menor debe tener al menos ${px}px.`,
  imageTooBigDimensions: (px) => `⚠️ La imagen tiene dimensiones demasiado grandes. Máximo ${px}px por lado.`,
  imageInvalid: '⚠️ No pude leer la imagen. Prueba a enviarla de nuevo.',
  visionNotConfigured: '⚠️ El análisis de imágenes no está configurado todavía. Avisa al administrador.',
  notAVehicle: '🤔 No veo ningún vehículo en esta foto. Envía una foto del coche, por favor.',
  multipleVehicles: '🚗🚗 Veo varios vehículos. Envía una foto con un solo coche, por favor.',
  unclearPhoto: '📷 No puedo ver bien el vehículo. Prueba con una foto más clara, con buena luz y el coche completo.',
  jobFailed: '❌ No pude procesar la foto. Inténtalo de nuevo en unos minutos.',
  access: {
    needInvite: '🔒 Este bot es privado. Pide a tu concesionario un enlace de invitación y ábrelo para empezar.',
    inviteInvalid: '⚠️ Esta invitación no es válida o ha caducado. Pide un enlace nuevo.',
    alreadyClaimed: '⚠️ Este sistema ya tiene propietario. Pide una invitación a tu concesionario.',
    linked: (role) => `✅ ¡Listo! Tu cuenta quedó vinculada como <b>${role}</b>. Envíame una foto de un vehículo para empezar.`,
    alreadyLinked: 'ℹ️ Tu cuenta ya está vinculada. Envíame una foto de un vehículo.',
    blocked: '⛔ Tu acceso está desactivado. Habla con el administrador de tu concesionario.',
    suspended: '⛔ La cuenta de este concesionario está suspendida.',
    notConfigured: '🛠️ El sistema aún no está configurado (falta la base de datos). Avisa al administrador.',
    dailyLimit: '⏳ Se alcanzó el límite diario de vehículos de tu concesionario. Inténtalo mañana.',
    monthlyLimit: '⏳ Se alcanzó el límite mensual de vehículos de tu plan.',
    inviteForbidden: '⛔ No tienes permiso para crear esa invitación.',
    inviteUsage: 'Uso: /invite [operador|editor|admin]',
    inviteCreated: (link, role, hours) =>
      `🔗 Invitación de un solo uso como <b>${role}</b> (caduca en ${hours} h):\n\n${link}\n\nEnvíala solo a la persona que quieras dar de alta.`,
  },
  roles: { OWNER: 'propietario', ADMIN: 'administrador', EDITOR: 'editor', OPERATOR: 'operador' },
  mockNotice: '🧪 <i>Modo demo: análisis simulado, no es una identificación real.</i>',
  captionIntro: '✍️ Texto para publicar:',
  labels: {
    version: 'Versión',
    year: 'Año',
    approx: 'aprox.',
    color: 'Color',
    bodyType: 'Carrocería',
    segment: 'Segmento',
    confidence: 'Confianza',
    features: 'Detalles visibles',
    missing: 'Me falta',
    unidentified: 'Vehículo no identificado',
  },
  sources: { detected: 'detectado', inferred: 'inferido', 'user-provided': 'indicado por ti', unknown: 'desconocido' },
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

const pt: Messages = {
  analyzing: '🚗 Analisando seu veículo…',
  welcome: '👋 Olá! Envie <b>uma foto</b> de um veículo e eu gero conteúdo de marketing pronto para publicar.',
  help:
    '📸 Envie uma foto nítida do veículo (JPG, PNG ou WebP).\n' +
    'Identifico marca, modelo, cor e carroceria, e devolvo um texto para redes sociais.\n\n' +
    'Comandos:\n/start – boas-vindas\n/help – esta ajuda\n/invite – convidar alguém (proprietário/administrador)',
  sendPhoto: '📸 Envie uma foto do veículo para começar.',
  unsupportedFile: '⚠️ Só aceito imagens JPG, PNG ou WebP.',
  imageTooLarge: (mb) => `⚠️ A imagem é grande demais. Máximo ${mb} MB.`,
  imageTooSmall: (px) => `⚠️ A imagem é pequena demais. O lado menor deve ter pelo menos ${px}px.`,
  imageTooBigDimensions: (px) => `⚠️ As dimensões da imagem são grandes demais. Máximo ${px}px por lado.`,
  imageInvalid: '⚠️ Não consegui ler a imagem. Tente enviar de novo.',
  visionNotConfigured: '⚠️ A análise de imagens ainda não está configurada. Avise o administrador.',
  notAVehicle: '🤔 Não vejo nenhum veículo nesta foto. Envie uma foto do carro, por favor.',
  multipleVehicles: '🚗🚗 Vejo vários veículos. Envie uma foto com um só carro, por favor.',
  unclearPhoto: '📷 Não consigo ver bem o veículo. Tente uma foto mais nítida, com boa luz e o carro inteiro.',
  jobFailed: '❌ Não consegui processar a foto. Tente novamente em alguns minutos.',
  access: {
    needInvite: '🔒 Este bot é privado. Peça à sua concessionária um link de convite e abra-o para começar.',
    inviteInvalid: '⚠️ Este convite não é válido ou expirou. Peça um link novo.',
    alreadyClaimed: '⚠️ Este sistema já tem proprietário. Peça um convite à sua concessionária.',
    linked: (role) => `✅ Pronto! Sua conta foi vinculada como <b>${role}</b>. Envie uma foto de um veículo para começar.`,
    alreadyLinked: 'ℹ️ Sua conta já está vinculada. Envie uma foto de um veículo.',
    blocked: '⛔ Seu acesso está desativado. Fale com o administrador da sua concessionária.',
    suspended: '⛔ A conta desta concessionária está suspensa.',
    notConfigured: '🛠️ O sistema ainda não está configurado (falta o banco de dados). Avise o administrador.',
    dailyLimit: '⏳ O limite diário de veículos da sua concessionária foi atingido. Tente amanhã.',
    monthlyLimit: '⏳ O limite mensal de veículos do seu plano foi atingido.',
    inviteForbidden: '⛔ Você não tem permissão para criar esse convite.',
    inviteUsage: 'Uso: /invite [operador|editor|admin]',
    inviteCreated: (link, role, hours) =>
      `🔗 Convite de uso único como <b>${role}</b> (expira em ${hours} h):\n\n${link}\n\nEnvie apenas para a pessoa que você quer cadastrar.`,
  },
  roles: { OWNER: 'proprietário', ADMIN: 'administrador', EDITOR: 'editor', OPERATOR: 'operador' },
  mockNotice: '🧪 <i>Modo demo: análise simulada, não é uma identificação real.</i>',
  captionIntro: '✍️ Texto para publicar:',
  labels: {
    version: 'Versão',
    year: 'Ano',
    approx: 'aprox.',
    color: 'Cor',
    bodyType: 'Carroceria',
    segment: 'Segmento',
    confidence: 'Confiança',
    features: 'Detalhes visíveis',
    missing: 'Falta',
    unidentified: 'Veículo não identificado',
  },
  sources: { detected: 'detectado', inferred: 'inferido', 'user-provided': 'informado por você', unknown: 'desconhecido' },
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

const en: Messages = {
  analyzing: '🚗 Analyzing your vehicle…',
  welcome: '👋 Hi! Send me <b>one photo</b> of a vehicle and I will create ready-to-post marketing content.',
  help:
    '📸 Send a clear photo of the vehicle (JPG, PNG or WebP).\n' +
    'I identify make, model, color and body type, and reply with social media copy.\n\n' +
    'Commands:\n/start – welcome\n/help – this help\n/invite – invite someone (owner/admin)',
  sendPhoto: '📸 Send me a photo of the vehicle to get started.',
  unsupportedFile: '⚠️ I only accept JPG, PNG or WebP images.',
  imageTooLarge: (mb) => `⚠️ The image is too large. Maximum ${mb} MB.`,
  imageTooSmall: (px) => `⚠️ The image is too small. The shorter side must be at least ${px}px.`,
  imageTooBigDimensions: (px) => `⚠️ The image dimensions are too large. Maximum ${px}px per side.`,
  imageInvalid: '⚠️ I could not read the image. Please send it again.',
  visionNotConfigured: '⚠️ Image analysis is not configured yet. Please tell your administrator.',
  notAVehicle: '🤔 I can’t see a vehicle in this photo. Please send a photo of the car.',
  multipleVehicles: '🚗🚗 I can see several vehicles. Please send a photo with just one car.',
  unclearPhoto: '📷 I can’t see the vehicle clearly. Try a sharper photo, with good light and the whole car in view.',
  jobFailed: '❌ I could not process the photo. Please try again in a few minutes.',
  access: {
    needInvite: '🔒 This bot is private. Ask your organization for an invite link and open it to get started.',
    inviteInvalid: '⚠️ This invite is invalid or has expired. Ask for a new link.',
    alreadyClaimed: '⚠️ This system already has an owner. Ask your organization for an invite.',
    linked: (role) => `✅ Done! Your account is linked as <b>${role}</b>. Send me a vehicle photo to get started.`,
    alreadyLinked: 'ℹ️ Your account is already linked. Send me a vehicle photo.',
    blocked: '⛔ Your access is disabled. Please talk to your organization admin.',
    suspended: '⛔ This organization account is suspended.',
    notConfigured: '🛠️ The system is not configured yet (database missing). Please tell your administrator.',
    dailyLimit: '⏳ Your organization reached its daily vehicle limit. Please try tomorrow.',
    monthlyLimit: '⏳ Your plan reached its monthly vehicle limit.',
    inviteForbidden: '⛔ You are not allowed to create that invite.',
    inviteUsage: 'Usage: /invite [operator|editor|admin]',
    inviteCreated: (link, role, hours) =>
      `🔗 Single-use invite as <b>${role}</b> (expires in ${hours} h):\n\n${link}\n\nOnly send it to the person you want to add.`,
  },
  roles: { OWNER: 'owner', ADMIN: 'admin', EDITOR: 'editor', OPERATOR: 'operator' },
  mockNotice: '🧪 <i>Demo mode: simulated analysis, not a real identification.</i>',
  captionIntro: '✍️ Ready-to-post copy:',
  labels: {
    version: 'Trim',
    year: 'Year',
    approx: 'approx.',
    color: 'Color',
    bodyType: 'Body',
    segment: 'Segment',
    confidence: 'Confidence',
    features: 'Visible details',
    missing: 'Still needed',
    unidentified: 'Vehicle not identified',
  },
  sources: { detected: 'detected', inferred: 'inferred', 'user-provided': 'provided by you', unknown: 'unknown' },
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

const MESSAGES: Record<Locale, Messages> = { es, pt, en };

export function messages(locale: Locale): Messages {
  return MESSAGES[locale];
}
