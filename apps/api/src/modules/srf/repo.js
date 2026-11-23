// SQL for SRFs (SALES_REQUEST_MASTER / SALES_REQUEST_DETAIL, TASKS P2-01). Branch-scoped, bound.
// Schedule lines are never deleted (CLAUDE.md rule 7): a line removed from a DRAFT keeps its row
// with QUANTITY 0 and is not read back.
import { businessDate, dec } from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { orderBy, paginate } from '../../lib/oracle/paginate.js';

const toDate = (iso) => new Date(`${iso}T00:00:00+05:00`);
const iso = (d) => (d ? businessDate(d) : null);
const n2 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(2));

/** Legacy SRFs have no DOC_STATUS: converted when an OC exists, else submitted. */
export const SRF_STATUS_SQL = `NVL(s.DOC_STATUS, CASE WHEN EXISTS (SELECT 1 FROM ORDER_CONFIRM o
  WHERE o.BRNCH = s.BRNCH AND o.SRF_NO = s.SRF_NO) THEN 'CONVERTED' ELSE 'SUBMITTED' END)`;

const COLS = `s.BRNCH, TO_CHAR(s.SRF_NO) AS SRF_NO, s.YEAR, s.SRF_DATE, s.CUSTOMER_CODE, c.CUSTOMER_NAME,
  c.ZONE_CODE AS CUST_ZONE, s.PRODUCT_CODE, s.DEST_GEO_CODE, g.CITY_NAME, g.AREA_NAME, g.GEO_LEVEL,
  s.BAG_CD, s.COLOR, s.QUANTITY, s.NO_OF_BAGS, s.MODE_OF_DELIV, s.MODE_OF_TRANSP, s.LOCAL_EXPORT,
  s.TERM_OF_SALE, s.SPECIAL_INST, s.REMARKS, s.NAME_OF_PER, s.SALES_TAX_TYPE, s.SALES_TAX_NO, s.NTN,
  s.CNIC, s.PINO, s.FORM_E, s.LC_NO, s.LEGAL_REQUIREMENTS, s.CR_REMARKS, s.CONTRACT_VALID_TO,
  TO_CHAR(s.DRAFT_OC_NO) AS DRAFT_OC_NO, ${SRF_STATUS_SQL} AS STATUS, s.ROW_VER,
  NVL(s.CREATED_BY, s.ENTER_BY) AS CREATED_BY, NVL(s.CREATED_ON, s.ENTER_DATE) AS CREATED_ON,
  s.UPDATED_BY, s.UPDATED_ON, s.APPROVED_BY, s.CANCEL_REASON, s.CANCELLED_BY, s.CANCELLED_ON`;
const FROM = `SALES_REQUEST_MASTER s
  LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = s.BRNCH AND c.CUSTOMER_CODE = s.CUSTOMER_CODE
  LEFT JOIN GEO_HIERARCHY g ON g.BRNCH = s.BRNCH AND g.GEO_CODE = s.DEST_GEO_CODE`;

export function mapSrf(r) {
  return {
    brnch: Number(r.BRNCH),
    srfNo: r.SRF_NO,
    year: r.YEAR === null ? null : Number(r.YEAR),
    srfDate: iso(r.SRF_DATE),
    customerCode: r.CUSTOMER_CODE,
    customerName: r.CUSTOMER_NAME ?? null,
    customerZone: r.CUST_ZONE ?? null,
    productCode: r.PRODUCT_CODE,
    destGeoCode: r.DEST_GEO_CODE ?? null,
    destName: r.CITY_NAME ?? r.AREA_NAME ?? null,
    bagCode: r.BAG_CD === null ? null : Number(r.BAG_CD),
    bagColour: r.COLOR === null ? null : Number(r.COLOR),
    qtyTon: n2(r.QUANTITY),
    bags: r.NO_OF_BAGS === null ? null : Number(r.NO_OF_BAGS),
    modeOfDelivery: r.MODE_OF_DELIV ?? null,
    modeOfTransport: r.MODE_OF_TRANSP ?? null,
    localExport: r.LOCAL_EXPORT ?? 'L',
    termOfSale: r.TERM_OF_SALE ?? 'A',
    specialInstructions: r.SPECIAL_INST ?? null,
    remarks: r.REMARKS ?? null,
    doHandoverTo: r.NAME_OF_PER ?? null,
    taxProfile: {
      stType: r.SALES_TAX_TYPE ?? null,
      strn: r.SALES_TAX_NO ?? null,
      ntn: r.NTN ?? null,
      cnic: r.CNIC ?? null,
    },
    export:
      r.PINO || r.FORM_E || r.LC_NO
        ? { piNo: r.PINO ?? null, formE: r.FORM_E ?? null, lcNo: r.LC_NO ?? null }
        : null,
    legalRequirements: r.LEGAL_REQUIREMENTS ?? null,
    crRemarks: r.CR_REMARKS ?? null,
    contractValidTo: iso(r.CONTRACT_VALID_TO),
    ocNo: r.DRAFT_OC_NO ?? null,
    status: r.STATUS,
    rowVer: Number(r.ROW_VER),
    createdBy: r.CREATED_BY ?? null,
    createdOn: r.CREATED_ON ?? null,
    updatedBy: r.UPDATED_BY ?? null,
    updatedOn: r.UPDATED_ON ?? null,
    approvedBy: r.APPROVED_BY ?? null,
    cancelReason: r.CANCEL_REASON ?? null,
    cancelledBy: r.CANCELLED_BY ?? null,
    cancelledOn: r.CANCELLED_ON ?? null,
  };
}

const SORTABLE = {
  srfNo: 's.SRF_NO',
  srfDate: 's.SRF_DATE',
  customerCode: 's.CUSTOMER_CODE',
  qtyTon: 's.QUANTITY',
};

/** @param {{ branches: number[], status?: string, customer?: string, from?: string, to?: string, q?: string, page?: number, pageSize?: number, sort?: string }} o */
export async function list(tx, o) {
  const bf = branchFilter('s.BRNCH', o.branches);
  const where = [bf.sql];
  const binds = { ...bf.binds };
  if (o.status) {
    where.push(`${SRF_STATUS_SQL} = :st`);
    binds.st = o.status;
  }
  if (o.customer) {
    where.push('s.CUSTOMER_CODE = :cu');
    binds.cu = o.customer;
  }
  if (o.from) {
    where.push('s.SRF_DATE >= :df');
    binds.df = toDate(o.from);
  }
  if (o.to) {
    where.push('s.SRF_DATE < :dt + 1');
    binds.dt = toDate(o.to);
  }
  if (o.q) {
    where.push(
      `(TO_CHAR(s.SRF_NO) LIKE :q ESCAPE '\\' OR UPPER(c.CUSTOMER_NAME) LIKE :q ESCAPE '\\' OR s.CUSTOMER_CODE LIKE :q ESCAPE '\\')`,
    );
    binds.q = `%${o.q.toUpperCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  }
  const page = await paginate(tx, {
    sql: `SELECT ${COLS} FROM ${FROM} WHERE ${where.join(' AND ')}
          ${orderBy(o.sort, SORTABLE, 's.SRF_DATE DESC NULLS LAST, s.SRF_NO DESC', 's.BRNCH, s.SRF_NO')}`,
    binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return { ...page, items: page.items.map(mapSrf) };
}

export async function get(tx, brnch, srfNo, { forUpdate = false } = {}) {
  if (forUpdate) {
    const l = await tx.one(
      'SELECT SRF_NO FROM SALES_REQUEST_MASTER WHERE BRNCH = :b AND SRF_NO = :n FOR UPDATE',
      { b: brnch, n: srfNo },
    );
    if (!l) return null;
  }
  const r = await tx.one(`SELECT ${COLS} FROM ${FROM} WHERE s.BRNCH = :b AND s.SRF_NO = :n`, {
    b: brnch,
    n: srfNo,
  });
  return r ? mapSrf(r) : null;
}

export async function schedule(tx, brnch, srfNo) {
  const rows = await tx.many(
    `SELECT TRIM(SR_NO) AS SR_NO, SCH_DATE, QUANTITY FROM SALES_REQUEST_DETAIL
      WHERE BRNCH = :b AND SRF_NO = :n AND QUANTITY > 0 ORDER BY TO_NUMBER(TRIM(SR_NO))`,
    { b: brnch, n: srfNo },
  );
  return rows.map((r) => ({
    srNo: Number(r.SR_NO),
    date: iso(r.SCH_DATE),
    qtyTon: n2(r.QUANTITY),
  }));
}

/** Header column values of an SRF body (create/update). */
function headerBinds(brnch, b) {
  return {
    sd: toDate(b.srfDate),
    cu: b.customerCode,
    pr: b.productCode,
    geo: b.destGeoCode,
    // legacy AREA_CODE = Hattar area doc of the city (Karachi legacy SRFs never had one)
    area: brnch === 2 ? (/-C(\d+)$/.exec(b.destGeoCode)?.[1] ?? null) : null,
    bag: b.bagCode ?? null,
    col: b.bagColour ?? null,
    qty: b.qtyTon,
    bags: b.bags ?? null,
    mod: b.modeOfDelivery,
    mot: b.modeOfTransport,
    le: b.localExport,
    tos: b.termOfSale,
    si: b.specialInstructions ?? null,
    rem: b.remarks ?? null,
    nop: b.doHandoverTo ?? null,
    stt: b.taxProfile?.stType ?? null,
    stn: b.taxProfile?.strn ?? null,
    ntn: b.taxProfile?.ntn ?? null,
    cnic: b.taxProfile?.cnic ?? null,
    pino: b.export?.piNo ?? null,
    fe: b.export?.formE ?? null,
    lc: b.export?.lcNo ?? null,
    legal: b.legalRequirements ?? null,
    crr: b.crRemarks ?? null,
    cvt: toDate(b.contractValidTo),
  };
}

export async function insert(tx, { brnch, srfNo, year, body, usrid, now }) {
  await tx.exec(
    `INSERT INTO SALES_REQUEST_MASTER (SRF_NO, BRNCH, COMPC, YEAR, SRF_DATE, CUSTOMER_CODE, PRODUCT_CODE,
       DEST_GEO_CODE, AREA_CODE, BAG_CD, COLOR, QUANTITY, NO_OF_BAGS, MODE_OF_DELIV, MODE_OF_TRANSP,
       LOCAL_EXPORT, TERM_OF_SALE, SPECIAL_INST, REMARKS, NAME_OF_PER, SALES_TAX_TYPE, SALES_TAX_NO, NTN,
       CNIC, PINO, FORM_E, LC_NO, LEGAL_REQUIREMENTS, CR_REMARKS, CONTRACT_VALID_TO, DOC_STATUS, ROW_VER,
       CREATED_BY, CREATED_ON, ENTER_BY, ENTER_DATE)
     VALUES (:n, :b, 1, :y, :sd, :cu, :pr, :geo, :area, :bag, :col, :qty, :bags, :mod, :mot, :le, :tos,
       :si, :rem, :nop, :stt, :stn, :ntn, :cnic, :pino, :fe, :lc, :legal, :crr, :cvt, 'DRAFT', 1,
       :usr, :now, :usr10, :now)`,
    {
      n: srfNo,
      b: brnch,
      y: year,
      ...headerBinds(brnch, body),
      usr: usrid,
      usr10: usrid.slice(0, 10),
      now,
    },
  );
}

export async function update(tx, { brnch, srfNo, rowVer, body, usrid, now }) {
  return tx.exec(
    `UPDATE SALES_REQUEST_MASTER SET SRF_DATE = :sd, CUSTOMER_CODE = :cu, PRODUCT_CODE = :pr,
       DEST_GEO_CODE = :geo, AREA_CODE = :area, BAG_CD = :bag, COLOR = :col, QUANTITY = :qty,
       NO_OF_BAGS = :bags, MODE_OF_DELIV = :mod, MODE_OF_TRANSP = :mot, LOCAL_EXPORT = :le,
       TERM_OF_SALE = :tos, SPECIAL_INST = :si, REMARKS = :rem, NAME_OF_PER = :nop,
       SALES_TAX_TYPE = :stt, SALES_TAX_NO = :stn, NTN = :ntn, CNIC = :cnic, PINO = :pino,
       FORM_E = :fe, LC_NO = :lc, LEGAL_REQUIREMENTS = :legal, CR_REMARKS = :crr,
       CONTRACT_VALID_TO = :cvt, ROW_VER = ROW_VER + 1, UPDATED_BY = :usr, UPDATED_ON = :now
     WHERE BRNCH = :b AND SRF_NO = :n AND ROW_VER = :rv`,
    { n: srfNo, b: brnch, rv: rowVer, ...headerBinds(brnch, body), usr: usrid, now },
  );
}

/** Write the schedule: update/insert given lines; lines no longer given get QUANTITY 0. */
export async function writeSchedule(tx, { brnch, srfNo, srfDate, lines }) {
  const existing = await tx.many(
    'SELECT TRIM(SR_NO) AS SR_NO FROM SALES_REQUEST_DETAIL WHERE BRNCH = :b AND SRF_NO = :n',
    { b: brnch, n: srfNo },
  );
  const have = new Set(existing.map((r) => Number(r.SR_NO)));
  const given = new Set(lines.map((l) => l.srNo));
  for (const l of lines) {
    const binds = {
      b: brnch,
      n: srfNo,
      sr: String(l.srNo),
      d: toDate(l.date),
      q: l.qtyTon,
      sd: toDate(srfDate),
    };
    if (have.has(l.srNo)) {
      await tx.exec(
        `UPDATE SALES_REQUEST_DETAIL SET SCH_DATE = :d, QUANTITY = :q, SRF_DATE = :sd
          WHERE BRNCH = :b AND SRF_NO = :n AND TRIM(SR_NO) = :sr`,
        binds,
      );
    } else {
      await tx.exec(
        `INSERT INTO SALES_REQUEST_DETAIL (SR_NO, SRF_NO, SCH_DATE, QUANTITY, SRF_DATE, COMPC, BRNCH)
         VALUES (:sr, :n, :d, :q, :sd, 1, :b)`,
        binds,
      );
    }
  }
  for (const no of have) {
    if (!given.has(no)) {
      await tx.exec(
        `UPDATE SALES_REQUEST_DETAIL SET QUANTITY = 0 WHERE BRNCH = :b AND SRF_NO = :n AND TRIM(SR_NO) = :sr`,
        { b: brnch, n: srfNo, sr: String(no) },
      );
    }
  }
}

export async function setStatus(tx, { brnch, srfNo, rowVer, status, usrid, now, extra = {} }) {
  const sets = [
    'DOC_STATUS = :st',
    'ROW_VER = ROW_VER + 1',
    'UPDATED_BY = :usr',
    'UPDATED_ON = :now',
  ];
  const binds = { b: brnch, n: srfNo, rv: rowVer, st: status, usr: usrid, now };
  if (extra.ocNo !== undefined) {
    sets.push('DRAFT_OC_NO = :oc');
    binds.oc = extra.ocNo;
  }
  if (extra.cancelReason !== undefined) {
    sets.push('CANCEL_REASON = :cr', 'CANCELLED_BY = :usr', 'CANCELLED_ON = :now');
    binds.cr = extra.cancelReason;
  }
  return tx.exec(
    `UPDATE SALES_REQUEST_MASTER SET ${sets.join(', ')}
      WHERE BRNCH = :b AND SRF_NO = :n AND ROW_VER = :rv`,
    binds,
  );
}
