// Gate-in (BUSINESS_RULES §11.1 BR-GATE, BR-DC-01/02; TASKS P3-04). One transaction: checks
// (vehicle free BR-GATE-04, transporter, bilty BR-GATE-02, documents open and combinable BR-GATE-03,
// planned ≤ what is left BR-DC-02), GATE_PASS row, DC number from DOC_SEQUENCE (BR-GATE-06) and the
// legacy DC header + lines (FH_DELIVERY_CHALLAN / FH_DEL_CHALLAN_DETAIL) with the new columns.
// DO route only for now: the permit route (FH_DELIVERY_MEMO) waits for the column mapping.
import {
  GATE_PASS_OPEN_STATES,
  businessDate,
  combineProblem,
  dec,
  fiscalYearOf,
  overPlanProblem,
  plannedOf,
} from '@dcl/shared';
import { AppError, Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { getDo } from '../do/service.js';
import { nextNumber } from '../numbering/service.js';
import { SettingsReader } from '../settings/service.js';

const ENTITY = 'GATE_PASS';
const OPEN_DO = ['ISSUED', 'PARTLY_DISPATCHED'];
const inList = (prefix, values) => ({
  sql: values.map((_, i) => `:${prefix}${i}`).join(', '),
  binds: Object.fromEntries(values.map((v, i) => [`${prefix}${i}`, v])),
});

const GP_COLS = `g.GP_ID, g.BRNCH, g.STATUS, g.ROUTE, g.CUSTOMER_CODE, c.CUSTOMER_NAME, g.DC_TYPE,
  g.DEST_AREA, g.PACKING_TYPE, g.VEHICLE_NO, g.DRIVER_CNIC, g.DRIVER_NAME, g.DRIVER_MOBILE,
  g.TRANSP_CODE, t.TRANSP_NAME, g.BILTY_NO, g.DC_YEAR, g.DC_NO, g.PLANNED_BAGS, g.PLANNED_KG,
  g.TARE_KG, g.TARE_ON, g.GROSS_KG, g.GROSS_ON, g.NET_KG, g.VARIANCE_KG, g.VARIANCE_PCT,
  g.VARIANCE_STATUS, g.GATE_IN_ON, g.GATE_IN_BY, g.EXIT_ON, g.EXIT_BY, g.CLIENT_ID, g.ROW_VER,
  g.WEIGHT_OVR_REQ_ID, g.EXIT_OVR_REQ_ID`;
const GP_FROM = `GATE_PASS g
  LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = g.BRNCH AND c.CUSTOMER_CODE = g.CUSTOMER_CODE
  LEFT JOIN TRANSPORTER_DESC t ON t.BRNCH = g.BRNCH AND t.TRANSP_CODE = g.TRANSP_CODE`;

const maskCnic = (c) => (c ? `${c.slice(0, 5)}-*******-${c.slice(12)}` : null);

function mapGatePass(r) {
  return {
    gpId: Number(r.GP_ID),
    brnch: Number(r.BRNCH),
    status: r.STATUS,
    route: r.ROUTE,
    customerCode: r.CUSTOMER_CODE ?? null,
    customerName: r.CUSTOMER_NAME ?? null,
    dcType: r.DC_TYPE ?? null,
    destArea: r.DEST_AREA ?? null,
    packingType: r.PACKING_TYPE,
    vehicleNo: r.VEHICLE_NO,
    driver: {
      cnic: maskCnic(r.DRIVER_CNIC),
      name: r.DRIVER_NAME ?? null,
      mobile: r.DRIVER_MOBILE ?? null,
    },
    transpCode: r.TRANSP_CODE ?? null,
    transpName: r.TRANSP_NAME ?? null,
    biltyNo: r.BILTY_NO ?? null,
    dcYear: r.DC_YEAR === null ? null : Number(r.DC_YEAR),
    dcNo: r.DC_NO === null ? null : String(r.DC_NO),
    plannedBags: r.PLANNED_BAGS === null ? null : Number(r.PLANNED_BAGS),
    plannedKg: r.PLANNED_KG === null ? null : Number(r.PLANNED_KG),
    tareKg: r.TARE_KG === null ? null : Number(r.TARE_KG),
    tareOn: r.TARE_ON ?? null,
    grossKg: r.GROSS_KG === null ? null : Number(r.GROSS_KG),
    grossOn: r.GROSS_ON ?? null,
    netKg: r.NET_KG === null ? null : Number(r.NET_KG),
    varianceKg: r.VARIANCE_KG === null ? null : Number(r.VARIANCE_KG),
    variancePct: r.VARIANCE_PCT === null ? null : dec(r.VARIANCE_PCT).toFixed(3),
    varianceStatus: r.VARIANCE_STATUS ?? null,
    gateInOn: r.GATE_IN_ON,
    gateInBy: r.GATE_IN_BY,
    exitOn: r.EXIT_ON ?? null,
    exitBy: r.EXIT_BY ?? null,
    clientId: r.CLIENT_ID ?? null,
    weightOvrReqId: r.WEIGHT_OVR_REQ_ID === null ? null : Number(r.WEIGHT_OVR_REQ_ID),
    exitOvrReqId: r.EXIT_OVR_REQ_ID === null ? null : Number(r.EXIT_OVR_REQ_ID),
    rowVer: Number(r.ROW_VER),
  };
}

/** Gate pass with its DC lines. */
export async function getGatePass(tx, gpId) {
  const r = await tx.one(`SELECT ${GP_COLS} FROM ${GP_FROM} WHERE g.GP_ID = :id`, { id: gpId });
  if (!r) throw Errors.notFound(`Gate pass ${gpId}`);
  const gp = mapGatePass(r);
  const lines =
    gp.route === 'DO' && gp.dcNo
      ? await tx.many(
          `SELECT l.DCD_SNO, l.DC_TYPE, TO_CHAR(l.DO_NO) AS DO_NO, TO_CHAR(l.OC_NO) AS OC_NO, l.PLANNED_BAGS,
                  l.PLANNED_TON, l.ALLOC_NET_KG, l.LINE_STATUS, l.INVOICE_ID
             FROM FH_DEL_CHALLAN_DETAIL l
            WHERE l.BRNCH = :b AND l.DC_TYPE = :t AND l.DC_NO = :n
            ORDER BY l.DCD_SNO`,
          { b: gp.brnch, t: gp.dcType, n: gp.dcNo },
        )
      : [];
  return {
    ...gp,
    lines: lines.map((l) => ({
      srNo: Number(l.DCD_SNO),
      doType: l.DC_TYPE,
      doNo: l.DO_NO,
      ocNo: l.OC_NO ?? null,
      plannedBags: l.PLANNED_BAGS === null ? null : Number(l.PLANNED_BAGS),
      plannedTon: dec(l.PLANNED_TON ?? 0).toFixed(3),
      allocNetKg: l.ALLOC_NET_KG === null ? null : Number(l.ALLOC_NET_KG),
      status: l.LINE_STATUS ?? 'ISSUED',
      invoiceId: l.INVOICE_ID === null ? null : Number(l.INVOICE_ID),
    })),
  };
}

/** Plant board: open gate passes of the branch, oldest first, with minutes since gate-in. */
export async function board(tx, brnch, now) {
  const st = inList('st', GATE_PASS_OPEN_STATES);
  const rows = await tx.many(
    `SELECT ${GP_COLS} FROM ${GP_FROM} WHERE g.BRNCH = :b AND g.STATUS IN (${st.sql})
      ORDER BY g.GATE_IN_ON`,
    { b: brnch, ...st.binds },
    { maxRows: 500 },
  );
  return rows.map((r) => {
    const gp = mapGatePass(r);
    return {
      ...gp,
      waitMin: Math.max(0, Math.floor((now.getTime() - new Date(gp.gateInOn).getTime()) / 60000)),
    };
  });
}

/** Tons still plannable on a DO: undispatched minus lines planned on open gate passes. */
async function openPlannedTon(tx, brnch, doNo) {
  const r = await tx.one(
    `SELECT NVL(SUM(l.PLANNED_TON), 0) AS T FROM FH_DEL_CHALLAN_DETAIL l
      WHERE l.BRNCH = :b AND l.DO_NO = :n AND NVL(l.LINE_STATUS, 'ISSUED') IN ('ISSUED', 'WEIGHED')`,
    { b: brnch, n: doNo },
  );
  return dec(r.T ?? 0);
}

/**
 * POST /plant/gate-passes (DO route).
 * @param {{ usrid: string, now: Date, audit: object, deviceId?: string }} actor
 */
export async function gateIn(tx, actor, brnch, body) {
  if (body.clientId) {
    const same = await tx.one('SELECT GP_ID FROM GATE_PASS WHERE CLIENT_ID = :c', {
      c: body.clientId,
    });
    if (same) return { ...(await getGatePass(tx, Number(same.GP_ID))), replay: true };
  }
  if (body.route !== 'DO')
    throw new AppError(
      'not_available',
      501,
      'Gate-in for permits is not available yet: the delivery memo (FH_DELIVERY_MEMO) mapping is being confirmed',
    );
  const settings = new SettingsReader(tx);
  // BR-GATE-02
  if ((await settings.bool(brnch, 'BILTY_REQUIRED')) && !body.biltyNo)
    throw Errors.rule('BR-GATE-02', 'Bilty number is required');
  const tr = await tx.one(
    `SELECT TRANSP_NAME FROM TRANSPORTER_DESC WHERE BRNCH = :b AND TRANSP_CODE = :t AND NVL(ACTIVE, 'Y') = 'Y'`,
    { b: brnch, t: body.transpCode },
  );
  if (!tr) throw Errors.validation(`Transporter ${body.transpCode} is not in the list`);
  // BR-GATE-04
  const st = inList('st', GATE_PASS_OPEN_STATES);
  const busy = await tx.one(
    `SELECT GP_ID, STATUS FROM GATE_PASS WHERE BRNCH = :b AND VEHICLE_NO = :v AND STATUS IN (${st.sql})`,
    { b: brnch, v: body.vehicleNo, ...st.binds },
  );
  if (busy)
    throw Errors.rule(
      'BR-GATE-04',
      `Vehicle ${body.vehicleNo} already has open gate pass ${busy.GP_ID} (${busy.STATUS})`,
      { gpId: Number(busy.GP_ID) },
    );

  // documents, locked so two gates cannot plan the same balance
  const seen = new Set();
  const lines = [];
  for (const d of body.docs) {
    const key = `${d.doType}|${d.doNo}`;
    if (seen.has(key)) throw Errors.validation(`DO ${d.doNo} is listed twice`);
    seen.add(key);
    const o = await getDo(tx, brnch, d.doType, d.doNo, { forUpdate: true });
    if (o.status === 'ON_HOLD')
      throw Errors.rule('BR-DO-07', `DO ${o.doNo} is on hold: ${o.holdReason ?? ''}`.trim());
    if (!OPEN_DO.includes(o.status))
      throw Errors.rule('BR-QR-02', `DO ${o.doNo} is ${o.status.toLowerCase()}`);
    const plan = plannedOf(d, body.packingType);
    const left = dec(o.remainingTon).minus(await openPlannedTon(tx, brnch, o.doNo));
    const over = overPlanProblem(
      plan.plannedTon,
      left.isNegative() ? '0' : left.toFixed(3),
      await settings.num(brnch, 'WEIGHT_TOLERANCE_KG'),
    );
    if (over) throw Errors.rule('BR-DC-02', `DO ${o.doNo}: ${over}`);
    lines.push({ o, plan });
  }
  const problem = combineProblem(
    lines.map((l) => ({
      customerCode: l.o.customerCode,
      doType: l.o.doType,
      destGeoCode: l.o.destGeoCode,
    })),
    'DO',
  );
  if (problem) throw Errors.rule('BR-GATE-03', problem);

  const first = lines[0].o;
  const geo = first.destGeoCode
    ? await tx.one('SELECT LEGACY_CODE FROM GEO_HIERARCHY WHERE BRNCH = :b AND GEO_CODE = :g', {
        b: brnch,
        g: first.destGeoCode,
      })
    : null;
  const destArea = geo?.LEGACY_CODE ? String(geo.LEGACY_CODE).slice(0, 15) : null;
  const cityCd = destArea && /^\d+$/.test(destArea) ? Number(destArea) : null;
  const totalTon = lines.reduce((s, l) => s.plus(dec(l.plan.plannedTon)), dec(0));
  const totalKg = lines.reduce((s, l) => s + l.plan.plannedKg, 0);
  const totalBags =
    body.packingType === 'BAG' ? lines.reduce((s, l) => s + l.plan.plannedBags, 0) : null;
  const year = fiscalYearOf(actor.now);
  const today = new Date(`${businessDate(actor.now)}T00:00:00+05:00`);

  // BR-GATE-06: the DC is issued at gate-in
  const gpId = await tx.nextId('SEQ_GATE_PASS');
  const dcNo = Number(await nextNumber(tx, { brnch, year, docType: 'DC' }));
  await tx.exec(
    `INSERT INTO GATE_PASS (GP_ID, BRNCH, COMPC, STATUS, ROUTE, CUSTOMER_CODE, DC_TYPE, DEST_AREA,
       PACKING_TYPE, VEHICLE_NO, DRIVER_CNIC, DRIVER_NAME, DRIVER_MOBILE, TRANSP_CODE, BILTY_NO, DC_YEAR,
       DC_NO, PLANNED_BAGS, PLANNED_KG, GATE_IN_ON, GATE_IN_BY, CLIENT_ID, DEVICE_ID, CREATED_ON, ROW_VER)
     VALUES (:id, :b, 1, 'IN', 'DO', :c, :t, :da, :pk, :v, :cn, :dn, :dm, :tc, :bl, :y, :dc, :bg, :kg, :now,
       :u, :cid, :dev, :now, 1)`,
    {
      id: gpId,
      b: brnch,
      c: first.customerCode,
      t: first.doType,
      da: destArea,
      pk: body.packingType,
      v: body.vehicleNo,
      cn: body.driver.cnic,
      dn: body.driver.name,
      dm: body.driver.mobile,
      tc: body.transpCode,
      bl: body.biltyNo ?? null,
      y: year,
      dc: dcNo,
      bg: totalBags,
      kg: totalKg,
      now: actor.now,
      u: actor.usrid,
      cid: body.clientId ?? null,
      dev: actor.deviceId ?? null,
    },
  );
  await tx.exec(
    `INSERT INTO FH_DELIVERY_CHALLAN (DC_NO, DC_TYPE, BRNCH, COMPC, CUSTOMER_CODE, TRANSP_NAME, DC_DATE,
       PACKING_TYPE, QUANTITY, CANCEL_CODE, VEHICLE_NO, TRANSP_CODE, ENTER_BY, ENTER_DATE, YEAR, POST,
       PRICE_CODE, CITY_CD, DOC_STATUS, ROW_VER, CREATED_BY, CREATED_ON, GP_ID, BILTY_NO, DEST_AREA, PLANNED_KG)
     VALUES (:dc, :t, :b, 1, :c, :tn, :d, :pk, :q, 'N', :v10, :tc, :u10, :now, :y, 'N', :pc, :city,
       'ISSUED', 1, :u, :now, :gp, :bl, :da, :kg)`,
    {
      dc: dcNo,
      t: first.doType,
      b: brnch,
      c: first.customerCode,
      tn: tr.TRANSP_NAME ?? null,
      d: today,
      pk: body.packingType,
      q: totalTon.toFixed(2),
      v10: body.vehicleNo.slice(0, 10), // legacy column is 10 wide; GATE_PASS keeps the full number
      tc: body.transpCode,
      u10: actor.usrid.slice(0, 10),
      now: actor.now,
      y: year,
      pc: first.priceCode ?? null,
      city: cityCd,
      u: actor.usrid,
      gp: gpId,
      bl: body.biltyNo ?? null,
      da: destArea,
      kg: totalKg,
    },
  );
  let sr = 0;
  for (const { o, plan } of lines) {
    sr += 1;
    await tx.exec(
      `INSERT INTO FH_DEL_CHALLAN_DETAIL (DC_NO, DO_NO, QUANTITY, DC_TYPE, OC_NO, CUSTOMER_CODE, PRICE_CODE,
         DCD_SNO, PACKING_TYPE, PLANNED_BAGS, PLANNED_TON, LINE_STATUS, COMPC, BRNCH)
       VALUES (:dc, :do, :q, :t, :oc, :c, :pc, :sr, :pk, :bg, :pt, 'ISSUED', 1, :b)`,
      {
        dc: dcNo,
        do: o.doNo,
        q: dec(plan.plannedTon).toFixed(2),
        t: o.doType,
        oc: o.ocNo,
        c: o.customerCode,
        pc: o.priceCode ?? null,
        sr,
        pk: body.packingType,
        bg: plan.plannedBags,
        pt: plan.plannedTon,
        b: brnch,
      },
    );
  }
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: String(gpId),
    action: 'GATE_IN',
    brnch,
    newValues: {
      route: 'DO',
      vehicleNo: body.vehicleNo,
      dcNo,
      docs: lines.map((l) => ({ doNo: l.o.doNo, ...l.plan })),
    },
  });
  return getGatePass(tx, gpId);
}
