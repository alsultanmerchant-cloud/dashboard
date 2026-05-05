import { getRequestConfig } from "next-intl/server";
import { getLocale } from "./locale";

export default getRequestConfig(async () => {
  const locale = await getLocale();
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return {
    locale,
    messages,
    // Always emit Latin digits, regardless of UI language.
    // `ar-SA-u-nu-latn` keeps Arabic month names but switches numerals to 0-9.
    formats: {
      number: {
        default: { maximumFractionDigits: 0 },
      },
    },
    now: new Date(),
  };
});
