// Masters screens (PRD §3 nav → P1-01). One nav entry can hold several related masters as tabs.
export const MASTER_SECTIONS = {
  products: {
    title: 'Products & periods',
    tabs: ['product-periods', 'product-types', 'product-groups', 'brands'],
  },
  'do-types': { title: 'DO types', tabs: ['do-types'] },
  bags: { title: 'Bags', tabs: ['bags', 'bag-colours'] },
  channels: { title: 'Channels', tabs: ['channels', 'categories', 'regions'] },
  banks: { title: 'Banks', tabs: ['company-banks', 'banks'] },
  instruments: { title: 'Instruments', tabs: ['instruments'] },
  transporters: { title: 'Transporters', tabs: ['transporters', 'transport-modes'] },
  'credit-types': { title: 'Credit types', tabs: ['credit-types'] },
  'note-types': { title: 'Note types', tabs: ['note-types'] },
};
