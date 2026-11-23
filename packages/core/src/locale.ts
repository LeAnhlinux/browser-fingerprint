// Ngôn ngữ chính theo mã quốc gia ISO 3166-1 alpha-2. Quốc gia ngoài bảng: giữ nguyên ngôn ngữ của hồ sơ.
const LANG_BY_COUNTRY: Record<string, string> = {
  US: 'en-US', GB: 'en-GB', CA: 'en-CA', AU: 'en-AU', NZ: 'en-NZ', IE: 'en-IE', SG: 'en-SG', IN: 'en-IN', ZA: 'en-ZA', PH: 'en-PH',
  VN: 'vi-VN', DE: 'de-DE', AT: 'de-AT', CH: 'de-CH', FR: 'fr-FR', BE: 'nl-BE', NL: 'nl-NL', ES: 'es-ES', MX: 'es-MX', AR: 'es-AR',
  CO: 'es-CO', CL: 'es-CL', IT: 'it-IT', PT: 'pt-PT', BR: 'pt-BR', PL: 'pl-PL', RU: 'ru-RU', UA: 'uk-UA', TR: 'tr-TR', SE: 'sv-SE',
  NO: 'nb-NO', DK: 'da-DK', FI: 'fi-FI', CZ: 'cs-CZ', RO: 'ro-RO', HU: 'hu-HU', GR: 'el-GR', JP: 'ja-JP', KR: 'ko-KR', CN: 'zh-CN',
  TW: 'zh-TW', HK: 'zh-HK', TH: 'th-TH', ID: 'id-ID', MY: 'ms-MY', AE: 'ar-AE', SA: 'ar-SA', IL: 'he-IL',
};

export function localeForCountry(country: string | null): { lang: string; acceptLang: string } | null {
  const lang = country ? LANG_BY_COUNTRY[country.toUpperCase()] : undefined;
  if (!lang) return null;
  const short = lang.split('-')[0];
  const acceptLang = short === 'en' ? `${lang},en` : `${lang},${short},en-US,en`;
  return { lang, acceptLang };
}
