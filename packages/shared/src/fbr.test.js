import { describe, expect, it } from 'vitest';
import { buildFbrPayload, readFbrResponse } from './fbr.js';

const inv = {
  invoiceDate: '2026-11-23',
  qtyTon: '35.000',
  productCode: 'OPC',
  productName: 'Ordinary Portland Cement',
  hsCode: null,
  stPct: '18.000',
  retailValue: '897898.31',
  saleProceeds: '850500.00',
  salesTax: '161621.60',
  fed: '140000.00',
  buyerName: 'MASHALLAH RICE MILL',
  buyerNtn: '7387041-3',
  buyerCnic: null,
  buyerStrn: '1700-1234-567-89',
  buyerAddress: 'Karachi',
};
const cfg = {
  ntn: '0712345-6',
  name: 'Dewan Cement Limited',
  province: 'Sindh',
  address: 'Dhabeji',
  saleType: 'Goods (FED in ST mode)',
  uom: 'MT',
  hsCode: '2523.2900',
};

describe('FBR payload (BR-FBR-02)', () => {
  it('BR-FBR-02: built from the stored invoice figures, never recomputed', () => {
    const r = buildFbrPayload(inv, cfg);
    expect(r.ok).toBe(true);
    expect(r.payload).toMatchObject({
      invoiceType: 'Sale Invoice',
      invoiceDate: '2026-11-23',
      sellerNTNCNIC: '07123456',
      buyerNTNCNIC: '73870413',
      buyerRegistrationType: 'Registered',
      buyerProvince: 'Sindh',
    });
    expect(r.payload.items[0]).toMatchObject({
      hsCode: '2523.2900',
      rate: '18%',
      uoM: 'MT',
      quantity: 35,
      totalValues: 850500,
      valueSalesExcludingST: 688878.4,
      fixedNotifiedValueOrRetailPrice: 897898.31,
      salesTaxApplicable: 161621.6,
      fedPayable: 140000,
      saleType: 'Goods (FED in ST mode)',
    });
  });
  it('missing settings or buyer id are listed instead of sending', () => {
    const r = buildFbrPayload({ ...inv, buyerNtn: null }, { ...cfg, name: '', hsCode: '' });
    expect(r).toEqual({
      ok: false,
      missing: [
        'seller name (FBR_SELLER_NAME)',
        'HS code (FBR_HS_CODE)',
        'buyer NTN or CNIC (customer tax tab)',
      ],
    });
  });
});

describe('FBR answer (BR-FBR-03/04)', () => {
  it('accepted, rejected with the error text, retry on timeout and 5xx', () => {
    expect(
      readFbrResponse(200, {
        invoiceNumber: '0712345DI1700000000123',
        validationResponse: { statusCode: '00', status: 'Valid' },
      }),
    ).toEqual({ result: 'ACCEPTED', retry: false, fbrInvoiceNo: '0712345DI1700000000123' });
    expect(
      readFbrResponse(200, {
        validationResponse: {
          statusCode: '01',
          status: 'Invalid',
          invoiceStatuses: [{ errorCode: '0052', error: 'Buyer NTN is not valid' }],
        },
      }),
    ).toMatchObject({
      result: 'REJECTED',
      retry: false,
      errorCode: '0052',
      errorMsg: 'Buyer NTN is not valid',
    });
    expect(readFbrResponse(null, null)).toMatchObject({ result: 'TIMEOUT', retry: true });
    expect(readFbrResponse(503, null)).toMatchObject({ result: 'ERROR', retry: true });
    expect(readFbrResponse(401, null)).toMatchObject({ result: 'ERROR', retry: false });
  });
});
