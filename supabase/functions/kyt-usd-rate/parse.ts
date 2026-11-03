type Rate = {
  deskID: number | null;
  currencyBase: string;
  currencyQuoted: string;
  currencyAmountOpt: string;
  pairIsHidden: number;
  rateAsk: string;
  rateAskOpt: string;
};

export function displayedUsdSale(html: string): number {
  const boot = html.match(/WUJS\.Load\('app-container',\s*(\{[\s\S]*?\}),\s*formComponent\)/)?.[1];
  if (!boot) throw new Error("Данные курсов КИТ Обмін не найдены.");

  const data = JSON.parse(boot) as {
    office?: { officeSaleMode?: string };
    activeDeskID?: number;
    desks?: { deskID: number }[];
    desksRates?: Rate[];
  };
  const mode = data.office?.officeSaleMode;
  if (
    (mode !== "opt" && mode !== "retail") || !Array.isArray(data.desks) ||
    !Array.isArray(data.desksRates)
  ) {
    throw new Error("Формат курсов КИТ Обмін изменился.");
  }

  const usdRate = (deskID: number) =>
    data.desksRates?.find((rate) =>
      rate.deskID === deskID && rate.currencyBase === "USD" && rate.currencyQuoted === "UAH"
    );
  const selected =
    data.desks.find((desk) => desk.deskID === data.activeDeskID && usdRate(desk.deskID)) ??
      data.desks.find((desk) => usdRate(desk.deskID));
  const rate = selected && usdRate(selected.deskID);
  if (!rate || Number(rate.pairIsHidden) !== 0) {
    throw new Error("Отображаемый курс продажи USD не найден.");
  }

  const raw = mode === "opt" && Number(rate.currencyAmountOpt) > 0
    ? rate.rateAskOpt
    : mode === "retail"
    ? rate.rateAsk
    : undefined;
  if (!raw || !/^\d{1,3}(?:[.,]\d{1,4})?$/.test(raw)) {
    throw new Error("Отображаемый курс продажи USD не найден.");
  }
  const value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) throw new Error("Некорректный курс продажи USD.");
  return value;
}
