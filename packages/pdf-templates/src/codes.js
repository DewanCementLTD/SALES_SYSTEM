// QR codes (signed payloads, BR-QR-01) and document-number barcodes for prints.
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';

/** QR as an SVG string (crisp at any print size). Error correction M fits the 80-char payload. */
export function qrSvg(text, { margin = 1 } = {}) {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin });
}

/** Code 128 barcode as SVG (DO / DC numbers, BR-DO-03). */
export function barcodeSvg(text, { height = 10, includetext = true } = {}) {
  return bwipjs.toSVG({
    bcid: 'code128',
    text: String(text),
    height,
    includetext,
    textxalign: 'center',
    scale: 2,
  });
}
