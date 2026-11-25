// What a complaint is about, read from the review's own words (English and Arabic). A review can name several reasons;
// one that names none is "Unspecified". Used by the Ratings & Reviews branch report.

export interface ReasonDef { key: string; label: string; short: string; en: RegExp[]; ar: string[] }

// Arabic is compared after normalising the letters people spell in different ways (أ إ آ → ا, ة → ه, ى → ي, no diacritics).
export const normalizeAr = (s: string): string =>
  String(s || "").toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");

const A = (words: string) => words.split("|").map((w) => normalizeAr(w.trim())).filter(Boolean);

export const REASONS: ReasonDef[] = [
  { key: "cold", label: "Cold", short: "Cold",
    en: [/\bcold\b/, /\bnot hot\b/, /\blukewarm\b/, /\bfrozen\b/],
    ar: A("بارد|باردة|بارده|برد|متجمد|مو سخن|مش سخن|مو ساخن|مش ساخن|غير ساخن|مب سخن|مب ساخن|فاتر") },
  { key: "late", label: "Late / Delay", short: "Late",
    en: [/\blate\b/, /\bdelay(ed)?\b/, /\bslow\b/, /\bwait(ed|ing)?\b/, /\bhours?\b/, /\btook (too )?long\b/, /\bforever\b/],
    ar: A("تاخر|متاخر|تاخير|تاخرت|بطي|بطيء|انتظار|انتظرت|ساعة|ساعتين|ما وصل") },
  { key: "food", label: "Food Quality", short: "Food",
    en: [/\btaste(s|d)?\b/, /\btasteless\b/, /\bbland\b/, /\bbad\b/, /\bworst\b/, /\braw\b/, /\bstale\b/, /\bdry\b/, /\bburn(t|ed)\b/, /\boily\b/, /\bgreasy\b/, /\bsoggy\b/,
         /\bsmell(s|ed)?\b/, /\bquality\b/, /\bdisgusting\b/, /\bnot fresh\b/, /\bfresh\b/, /\bsalty\b/, /\bhorrible\b/, /\bterrible\b/, /\bawful\b/, /\bnasty\b/, /\bundercooked\b/, /\bovercooked\b/],
    ar: A("طعم|سيء|سيئ|سيئة|وحش|زفت|مو لذيذ|مش لذيذ|غير لذيذ|محروق|نيء|قديم|قديمة|مالح|زيت|زيتي|ريحة|رائحة|ناشف|يابس|جاف|رديء|بايخ|فاسد|خايس|فرش|طازج|لا تجربه|تجربه سيئه|ما يستاهل|مقرف|حامض|فاشل|مب زين|مو زين|ما عجبني|ما اعجبني") },
  { key: "missing", label: "Missing / Wrong Item", short: "Missing",
    en: [/\bmissing\b/, /\bwrong\b/, /\bforgot(ten)?\b/, /\bwithout\b/, /\bnot included\b/, /\bincomplete\b/, /\binstead\b/, /\bdidn't (come|include|receive)\b/, /\bnot (received|delivered)\b/, /\bmistake\b/, /\bdifferent\b/],
    ar: A("فقط|ناقص|نقص|ناقصة|غلط|خطا|خطأ|بدون|مو موجود|مش موجود|ناسي|نسيو|نسوا|نسيوا|ما جاء|ما جاني|ما وصلني|مفقود|مختلف|غير المطلوب|المفروض|مفروض|ما طلبت|بدل|مب موجود|ماجا") },
  { key: "portion", label: "Small Portion / Value", short: "Portion",
    en: [/\bsmall\b/, /\bportion\b/, /\btiny\b/, /\bexpensive\b/, /\bprice[sd]?\b/, /\boverpriced\b/, /\bvalue\b/, /\bquantity\b/, /\blittle\b/, /\bnot worth\b/],
    ar: A("قليل|قليلة|صغير|صغيرة|كمية|غالي|غالية|سعر|اسعار|مرتفع|مو يسوى|ما يسوى|حجم|ثمن") },
  { key: "packaging", label: "Packaging / Spill", short: "Packaging",
    en: [/\bpackag(e|ing)\b/, /\bspill(ed|s)?\b/, /\bleak(ed|ing|s)?\b/, /\bcrushed\b/, /\bmess(y)?\b/, /\bopen(ed)?\b/, /\bbag\b/, /\bbox\b/, /\bsquashed\b/, /\bdamaged\b/],
    ar: A("تغليف|انسكب|منسكب|مسكوب|سايح|سكب|تسرب|كيس|علبة|مفتوح|مفتوحة|ممعوس|مكسور|مهروس|معفس") },
  { key: "driver", label: "Driver / Delivery", short: "Driver",
    en: [/\bdriver\b/, /\brider\b/, /\bcourier\b/, /\bdelivery (guy|man|boy)\b/, /\brude\b/, /\bbehaviou?r\b/],
    ar: A("السائق|سائق|سواق|السواق|المندوب|مندوب|الدليفري|دليفري|وقاحة|قليل ادب|اخلاق") },
];
export const UNSPECIFIED = { key: "unspecified", label: "Unspecified (no reason)", short: "Unspecified" };

/** Reasons (keys) a review text names, in the list's order. Empty = none named. */
export function reasonsOf(text: string | null | undefined): string[] {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const ar = normalizeAr(raw);
  // Arabic words are matched at the START of a word (with or without the prefixes ال و ب ل ك ف), so "طعم" (taste) does not
  // fire inside "مطعم" (restaurant). A phrase of several words is matched as text.
  const tokens = ar.split(/[^ء-ي]+/).filter(Boolean);
  const bare = tokens.map((t) => t.replace(/^(ال|و|ب|ل|ك|ف)+/, ""));
  const hasAr = (w: string) => (w.includes(" ") ? ar.includes(w) : tokens.some((t, i) => t.startsWith(w) || bare[i].startsWith(w)));
  const out: string[] = [];
  for (const r of REASONS) {
    if (r.en.some((re) => re.test(lower)) || r.ar.some(hasAr)) out.push(r.key);
  }
  return out;
}
