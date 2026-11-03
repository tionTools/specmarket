import { displayedUsdSale } from "./parse.ts";

const page = (data: object) =>
  `<script>WUJS.Load('app-container', ${JSON.stringify(data)}, formComponent);</script>`;
const rate = (deskID: number, retail: string, opt: string) => ({
  deskID,
  currencyBase: "USD",
  currencyQuoted: "UAH",
  currencyAmountOpt: "500",
  pairIsOpt: 0,
  pairIsHidden: 0,
  rateAsk: retail,
  rateAskOpt: opt,
});
const data = {
  office: { officeSaleMode: "opt" },
  activeDeskID: 0,
  desks: [{ deskID: 54 }, { deskID: 52 }],
  desksRates: [rate(0, "47.60", "47.50"), rate(54, "46.40", "46.30"), rate(52, "46.80", "46.70")],
};

Deno.test("uses the first displayed desk and sale mode, not the server HTML rate", () => {
  if (displayedUsdSale(page(data)) !== 46.30) throw new Error("Wrong displayed sale rate");
  if (displayedUsdSale(page({ ...data, activeDeskID: 52 })) !== 46.70) {
    throw new Error("Wrong active desk");
  }
  if (displayedUsdSale(page({ ...data, office: { officeSaleMode: "retail" } })) !== 46.40) {
    throw new Error("Wrong retail sale rate");
  }
});

Deno.test("rejects missing or invalid displayed rates", () => {
  for (
    const html of [
      page({ ...data, desksRates: [] }),
      page({ ...data, desksRates: [rate(54, "46.40", "0")] }),
      page({ ...data, office: {} }),
      "<html></html>",
    ]
  ) {
    let rejected = false;
    try {
      displayedUsdSale(html);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Invalid page accepted");
  }
});
