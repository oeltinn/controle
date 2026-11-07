const country = () => document.getElementById('clientPhoneCountry');
const input = () => document.getElementById('clientPhone');
let loading;

function loadPhoneLibrary() {
  return loading ??= import('libphonenumber-js/max').catch(error => { loading = undefined; throw error; });
}

export async function initializeClientPhone() {
  const lib = await loadPhoneLibrary();
  const select = country();
  if (select.options.length > 1) return;
  const names = new Intl.DisplayNames(['pt-BR'], {type:'region'});
  const countries = lib.getCountries().map(code => [code, names.of(code) || code]);
  countries.sort((a,b) => a[1].localeCompare(b[1],'pt-BR'));
  for (const [code,name] of countries) {
    if (code !== 'BR') select.add(new Option(`${name} (+${lib.getCountryCallingCode(code)})`, code));
  }
  const format = () => {
    const field = input();
    if (document.activeElement === field) return;
    const number = lib.parsePhoneNumberFromString(field.value, {defaultCountry:select.value,extract:false});
    if (number?.country === select.value && number.isValid()) field.value = number.formatNational();
  };
  input().addEventListener('blur',format);
  select.addEventListener('change',format);
}

export async function readClientPhone() {
  const value = input().value.trim();
  if (!value) return null;
  const lib = await loadPhoneLibrary();
  const code = country().value;
  const number = lib.parsePhoneNumberFromString(value, {defaultCountry:code,extract:false});
  if (!number?.isValid() || number.ext || number.countryCallingCode !== lib.getCountryCallingCode(code) || (number.country && number.country !== code)) {
    input().focus();
    throw new Error('Informe um telefone válido para o país selecionado, incluindo o código de área quando necessário.');
  }
  return number.number;
}
