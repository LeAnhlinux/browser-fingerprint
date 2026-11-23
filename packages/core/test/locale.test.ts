import { describe, expect, it } from 'vitest';
import { localeForCountry } from '../src/locale';

describe('localeForCountry', () => {
  it('trả ngôn ngữ cho quốc gia có trong bảng, không phân biệt hoa thường', () => {
    expect(localeForCountry('US')).toEqual({ lang: 'en-US', acceptLang: 'en-US,en' });
    expect(localeForCountry('vn')).toEqual({ lang: 'vi-VN', acceptLang: 'vi-VN,vi,en-US,en' });
    expect(localeForCountry('DE')).toEqual({ lang: 'de-DE', acceptLang: 'de-DE,de,en-US,en' });
  });

  it('trả null cho quốc gia ngoài bảng hoặc giá trị rỗng', () => {
    expect(localeForCountry('ZZ')).toBeNull();
    expect(localeForCountry(null)).toBeNull();
    expect(localeForCountry('')).toBeNull();
  });
});
