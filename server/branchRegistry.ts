// Source of truth for brand / branch spellings. Canonical names are the ones already in the database (never renamed);
// this file only adds the other ways each one is written. Applied by seedNameRegistry() on every start: aliases are
// MERGED into what is stored (what users taught the system survives), nothing is replaced, renamed or created.
export interface RegistryBrand {
  brand: string;
  brandAliases?: string[];
  branches?: { name: string; aliases: string[] }[];
  /** Store names that genuinely name two branches at once: suggested, never linked automatically. */
  neverAutoLink?: string[];
}

export const BRANCH_REGISTRY: RegistryBrand[] = [
  { brand: "Yelo Pizza", brandAliases: ["Yelo! Pizza", "Yelo"], branches: [
    { name: "Andalous", aliases: ["Andalus"] },
    { name: "Ardhiya", aliases: ["Rai"] },
    { name: "Jaber Al Ahmed", aliases: ["Jahra - Taima", "Jaber Al-Ahmad"] },
    { name: "Jahra", aliases: ["Jahra Core"] },
    { name: "Jleeb Al Shuyoukh", aliases: ["Jleeb"] },
    { name: "Khairan", aliases: ["Al Khairan", "Al-Khiran"] },
    { name: "Maidan Hawally", aliases: ["Shaab", "Midan Hawally"] },
    { name: "Qortuba", aliases: ["Surra"] },
    { name: "Qurain", aliases: ["Mubarak Al Kabeer"] },
    { name: "Sabah Al Salem", aliases: ["Fnaitess", "Fnaitees", "Yard - Fnaitees"] },
    { name: "Abdullah Al Salem (Dahiya)", aliases: ["Dahiya Abdullah", "Abdulla Al-Salem", "Abdullah AlSalem", "Dahiya Abdulla Salem", "Abdulla Al-Salem-3-Co Op"] },
    { name: "Vibes", aliases: ["Abu Halifa", "Abu Hasaniya", "Abu Al Hassaniya", "Abu Al Hassaniya - Vibes Complex", "Abu Halifa-11-Vibes Complex"] },
    { name: "Zahra", aliases: ["Mubarak Al Abdullah-4-Co Op"] },
    { name: "Ishbiliya", aliases: ["Ishbilya"] },
  ] },
  { brand: "Shawarma Shakir", brandAliases: ["Shakir"], branches: [
    { name: "Kuwait City", aliases: ["City", "Sharq"] },
    { name: "Egaila", aliases: ["Jaber Al Ali"] },
    { name: "Hawally", aliases: ["Shaab"] },
    { name: "Ardhiya", aliases: ["Reggai"] },
  ] },
  { brand: "BBT", branches: [
    { name: "Hilltop", aliases: ["Kuwait City"] },
    { name: "Yard", aliases: ["Vibes", "Fahad Al Ahmed"] },
    { name: "Shuhada", aliases: ["Rumaithiya"] },
    { name: "Adaliya", aliases: ["Faiha"] },
    { name: "Saad Al Abdullah", aliases: ["Jahra - Jahra Area - Saad Al-Abdullah"] },
  ], neverAutoLink: ["Ali Sabah Al-Salem - Umm Al Hayman"] },
  { brand: "Slice", brandAliases: ["Slice Doner"], branches: [
    { name: "Adaliya", aliases: ["Adiliya"] },
    { name: "Kuwait City", aliases: ["City", "Qibla"] },
    { name: "Mishref", aliases: ["Mubarak Al-Abdullah (West Mishref)", "Mubarak Al-Abdullah", "West Mishref"] },
    { name: "Yard", aliases: ["Vibes", "Vibes Complex", "Abu Hasaniya", "Yard Mall"] },
  ] },
  { brand: "Pattie Pattie", brandAliases: ["Pattie Pattie Sliders", "Pattie"], branches: [
    { name: "Ardhiya", aliases: ["Farwaniya"] },
    { name: "Yard", aliases: ["Fnaitess"] },
    { name: "Mishref", aliases: ["Mubarak Al-Abdullah - West Mishref", "Mubarak Al-Abdullah"] },
  ] },
  { brand: "Just C", branches: [{ name: "Yard", aliases: ["Abu Hasaniya"] }] },
  { brand: "Chili Pepper", branches: [
    { name: "Qortuba", aliases: ["Qurtoba"] },
    { name: "Yard", aliases: ["Vibes", "Yard Mall"] },
  ] },
  { brand: "Mishmash", branches: [
    { name: "Mahboula", aliases: ["Abu Halifa", "Abu Halifa, Mahboula"] },
    { name: "Kaifan", aliases: ["Kaifan Kuwait Sport Club"] },
    { name: "Ardhiya", aliases: ["Firdous", "Ferdous"] },
    { name: "Jabriya", aliases: ["Surra"] },
    { name: "Sabah Al Salem", aliases: ["Adan", "S-Salem"] },
    { name: "West Abdullah Al Mubarak", aliases: ["W-Abdullah"] },
  ] },
  { brand: "Tabel", brandAliases: ["Table"], branches: [
    { name: "Ahmadi", aliases: ["East-Ahmadi", "Al-Ahmadi", "Ahmadi, Al-Ahmadi"] },
  ] },
  { brand: "FM", brandAliases: ["Forevermore", "Forever More"], branches: [
    { name: "Kuwait City", aliases: ["City", "Qibla", "Sharq"] },
  ] },
];
