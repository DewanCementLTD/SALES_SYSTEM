// FBR Digital Invoicing (PRAL) payload and response (BUSINESS_RULES BR-FBR-02/03/04; TASKS P3-07).
// The payload is built from the STORED invoice row, never recomputed (BR-TAX-08). Field names follow
// the PRAL DI API (postinvoicedata / postinvoicedata_sb). The value mapping for retail-price goods,
// the sale type and the unit are settings and MUST be verified in the FBR sandbox with DCL's token
// before go-live.
import { dec } from './money.js';

const num = (v) => Number(dec(v ?? 0).toFixed(2));

/**
 * @param {{ invoiceDate: string, qtyTon: string, productCode: string, productName?: string|null,
 *   hsCode?: string|null, stPct: string, retailValue: string, saleProceeds: string, salesTax: string,
 *   fed: string, furtherTax?: string, wht?: string, buyerName: string|null, buyerNtn: string|null,
 *   buyerCnic: string|null, buyerStrn: string|null, buyerAddress: string|null,
 *   buyerProvince?: string|null }} inv
 * @param {{ ntn: string, name: string, province: string, address: string, saleType: string,
 *   uom: string, hsCode?: string, scenarioId?: string }} cfg
 * @returns {{ ok: true, payload: object } | { ok: false, missing: string[] }}
 */
export function buildFbrPayload(inv, cfg) {
  const missing = [];
  const need = (v, what) => {
    if (v === null || v === undefined || String(v).trim() === '') missing.push(what);
    return v;
  };
  need(cfg.ntn, 'seller NTN (FBR_SELLER_NTN)');
  need(cfg.name, 'seller name (FBR_SELLER_NAME)');
  need(cfg.province, 'seller province (FBR_SELLER_PROVINCE)');
  const hs = inv.hsCode || cfg.hsCode;
  need(hs, 'HS code (FBR_HS_CODE)');
  const buyerId = (inv.buyerNtn || inv.buyerCnic || '').replace(/[^0-9]/g, '');
  need(buyerId, 'buyer NTN or CNIC (customer tax tab)');
  if (missing.length) return { ok: false, missing };

  const registered = Boolean(inv.buyerStrn && String(inv.buyerStrn).trim());
  const payload = {
    invoiceType: 'Sale Invoice',
    invoiceDate: inv.invoiceDate,
    sellerNTNCNIC: String(cfg.ntn).replace(/[^0-9]/g, ''),
    sellerBusinessName: cfg.name,
    sellerProvince: cfg.province,
    sellerAddress: cfg.address ?? '',
    buyerNTNCNIC: buyerId,
    buyerBusinessName: inv.buyerName ?? '',
    buyerProvince: inv.buyerProvince || cfg.province,
    buyerAddress: inv.buyerAddress ?? '',
    buyerRegistrationType: registered ? 'Registered' : 'Unregistered',
    invoiceRefNo: '',
    ...(cfg.scenarioId ? { scenarioId: cfg.scenarioId } : {}),
    items: [
      {
        hsCode: hs,
        productDescription: inv.productName || inv.productCode,
        rate: `${dec(inv.stPct).toString()}%`,
        uoM: cfg.uom,
        quantity: Number(dec(inv.qtyTon).toFixed(3)),
        totalValues: num(inv.saleProceeds),
        valueSalesExcludingST: num(dec(inv.saleProceeds).minus(dec(inv.salesTax))),
        fixedNotifiedValueOrRetailPrice: num(inv.retailValue),
        salesTaxApplicable: num(inv.salesTax),
        salesTaxWithheldAtSource: 0,
        extraTax: '',
        furtherTax: num(inv.furtherTax ?? 0),
        sroScheduleNo: '',
        fedPayable: num(inv.fed),
        discount: 0,
        saleType: cfg.saleType,
        sroItemSerialNo: '',
      },
    ],
  };
  return { ok: true, payload };
}

/**
 * BR-FBR-03/04: what an FBR answer means.
 * @param {number|null} httpStatus null = no answer (network error / timeout)
 * @param {any} body parsed JSON or null
 * @returns {{ result: 'ACCEPTED'|'REJECTED'|'ERROR'|'TIMEOUT', retry: boolean, fbrInvoiceNo?: string,
 *   errorCode?: string, errorMsg?: string }}
 */
export function readFbrResponse(httpStatus, body) {
  if (httpStatus === null)
    return { result: 'TIMEOUT', retry: true, errorMsg: 'No answer from FBR' };
  if (httpStatus >= 500 || httpStatus === 429)
    return { result: 'ERROR', retry: true, errorMsg: `FBR HTTP ${httpStatus}` };
  if (httpStatus === 401 || httpStatus === 403)
    return {
      result: 'ERROR',
      retry: false,
      errorCode: String(httpStatus),
      errorMsg: 'FBR refused the token (FBR_TOKEN_ENC)',
    };
  const v = body?.validationResponse ?? {};
  const items = Array.isArray(v.invoiceStatuses) ? v.invoiceStatuses : [];
  const itemErr = items.find((i) => i?.error);
  if (httpStatus === 200 && v.statusCode === '00' && body?.invoiceNumber)
    return { result: 'ACCEPTED', retry: false, fbrInvoiceNo: String(body.invoiceNumber) };
  return {
    result: 'REJECTED',
    retry: false,
    errorCode: String(v.errorCode || itemErr?.errorCode || v.statusCode || httpStatus),
    errorMsg: String(v.error || itemErr?.error || v.status || `FBR HTTP ${httpStatus}`).slice(
      0,
      2000,
    ),
  };
}
