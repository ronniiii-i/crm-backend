import { BadRequestException } from '@nestjs/common';
import {
  deriveCurrencySymbol,
  validateTenantSettingsPatch,
} from './tenant-settings.validation';

describe('tenant settings validation', () => {
  it('derives the currency symbol from the locale', () => {
    expect(deriveCurrencySymbol('NGN', 'en-NG')).toBe('₦');
    expect(deriveCurrencySymbol('USD', 'en-US')).toBe('$');
  });

  it('normalises and validates a full patch', () => {
    expect(
      validateTenantSettingsPatch({
        name: '  Acme  ',
        currency: 'ngn',
        currencySymbol: '₦',
        dateFormat: 'yyyy-MM-dd',
        timeZone: 'Africa/Lagos',
        locale: 'en-NG',
        weekStartsOn: 1,
      }),
    ).toEqual({
      name: 'Acme',
      currency: 'NGN',
      currencySymbol: '₦',
      dateFormat: 'yyyy-MM-dd',
      timeZone: 'Africa/Lagos',
      locale: 'en-NG',
      weekStartsOn: 1,
    });
  });

  it.each([
    [{ currency: 'BTC' }, 'currency'],
    [{ dateFormat: 'epoch' }, 'dateFormat'],
    [{ timeZone: 'Mars/Olympus' }, 'timeZone'],
    [{ locale: 'not a locale!' }, 'locale'],
    [{ weekStartsOn: 9 }, 'weekStartsOn'],
    [{ currencySymbol: 'ABCD' }, 'currencySymbol'],
    [{ name: '   ' }, 'name'],
  ])('rejects %j', (body, field) => {
    expect(() => validateTenantSettingsPatch(body)).toThrow(new RegExp(field));
    expect(() => validateTenantSettingsPatch(body)).toThrow(
      BadRequestException,
    );
  });

  it('allows clearing the currency symbol override', () => {
    expect(
      validateTenantSettingsPatch({ currencySymbol: '' }).currencySymbol,
    ).toBeNull();
  });
});
