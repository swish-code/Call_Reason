// Defaults for offer campaigns (the first one is the Shakir win-back campaign, requested by Ahmed Kamal,
// Oct 2026). Everything here is only the starting value: leaders edit the script, validity and churn
// reasons on the page, and those edits live in the offer_campaigns row.

export const SHAKIR_CAMPAIGN_ID = "ofc-shakir";

export const DEFAULT_STEPS = [20, 30, 50];          // 1st, 2nd, 3rd order discount (%)
export const DEFAULT_VALIDITY_DAYS = 30;

export const DEFAULT_CHURN_REASONS = [
  "Price / too expensive",
  "Food quality or taste",
  "Late delivery",
  "Wrong or missing items",
  "Customer service",
  "Ordering from a competitor",
  "Moved / outside the delivery area",
  "Ordering through another app",
  "No specific reason",
  "Other",
];

// The call results an agent picks from (seeded into Configuration → Shakir Campaign). Each one works like a built-in
// status — the [status, label] pairs below are the built-ins themselves.
export const DEFAULT_CALL_RESULTS: [string, string][] = [
  ["no_answer", "No answer"],
  ["busy", "Busy / switched off"],
  ["call_back", "Call back later"],
  ["wrong_number", "Wrong number"],
  ["not_interested", "Not interested"],
  ["accepted", "Accepted the offer"],
  ["ordered", "Ordered"],
];

export const SHAKIR_SCRIPT_AR = `سيناريو المكالمة باللغة العربية

الموظف: أهلاً بحضرتك أستاذ/أستاذة [اسم العميل]، مع حضرتك [اسم الموظف] من مطعم شاورما شاكر. في الأول حابب أشكر حضرتك جداً على ثقتك فينا، وحضرتك من عملائنا المميزين جداً بالنسبة لنا، ومصممين لحضرتك عرض خاص في نهاية المكالمة.

الموظف: لاحظنا إن حضرتك بقالك فترة متواصلتش معانا أو عملت طلب من خلالنا، ولأن رضا حضرتك هو أهم حاجة عندنا، حابب أتأكد لو كان في أي مشكلة أو ملاحظة واجهتك في آخر تعامل خلتك تتأخر في الطلب مننا؟

(يستمع الموظف لرد العميل باهتمام، ويدوّن السبب في خانة الملاحظات ويسجل شكوى إن وجد، مع تقديم الاعتذار أو التوضيح)

الموظف: شكراً جداً لوقت حضرتك وتوضيحك. وتقديراً لولاء حضرتك وحرصنا على تقديم أفضل تجربة، صممنا لحضرتك عرض خاص ومميز جداً صالح لمدة 30 يوم على طلباتك الثلاثة القادمة:
الطلب الأول: خصم 20%
الطلب الثاني: خصم 30%
الطلب الثالث: خصم 50%
العرض ده متاح حصرياً عند الطلب من خلالنا في الكول سنتر خلال الـ 30 يوم القادمين.

الموظف: تحب أساعد حضرتك نجهز طلبك الأول اليوم ونستفيد بخصم الـ 20% فوراً؟`;

export const SHAKIR_SCRIPT_EN = `Call scenario in English

Agent: Hello [Customer Name], this is [Agent Name] calling from Shawerma Shaker. First, I want to personally reach out and thank you for being one of our most valued customers. We truly appreciate your trust in us, and we have designed a very special offer for you at the end of the call.

Agent: We noticed it's been a little while since your last order, and your experience is extremely important to us. Is there any specific issue, feedback, or inconvenience you faced that prevented you from ordering recently?

(Agent listens attentively, takes notes, registers a complaint if found and acknowledges any issue with empathy)

Agent: Thank you for sharing that with me. To show our appreciation and ensure you have a great experience moving forward, we have designed a very special, exclusive offer for you, valid for 30 days and applicable to your next three orders:
1st Order: 20% OFF
2nd Order: 30% OFF
3rd Order: 50% OFF
All three discounts are valid for the next 30 days and can be redeemed exclusively when you order directly through our call center team.

Agent: Can I assist you in placing your first order today so we can apply your 20% discount right now?`;
