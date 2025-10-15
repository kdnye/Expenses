export type CategoryAccountInfo = {
  account: string | null;
  label: string;
};

const CATEGORY_ACCOUNT_TUPLES: Array<[string, CategoryAccountInfo]> = [
  ['maintenance_repairs', { account: '51020', label: 'Maintenance & Repairs' }],
  ['parking_storage_cogs', { account: '51070', label: 'Parking & Storage - COGS' }],
  ['vehicle_supplies', { account: '51090', label: 'Vehicle Supplies' }],
  ['state_permits', { account: '52030', label: 'State Permits / Fees / Tolls' }],
  ['meals_cogs', { account: '52070', label: 'Meals & Entertainment - COGS' }],
  ['travel_cogs', { account: '52080', label: 'Travel - COGS' }],
  ['fsi_global_overhead', { account: '56000', label: 'FSI Global Overhead' }],
  ['telephone_ga', { account: '62000', label: 'Telephone - GA' }],
  ['utilities', { account: '62070', label: 'Utilities' }],
  ['it_computer', { account: '62080', label: 'IT / Computer' }],
  ['office_supplies', { account: '62090', label: 'Office Supplies' }],
  ['printing_postage', { account: '62100', label: 'Printing & Postage' }],
  ['meals_ga', { account: '64180', label: 'Meals & Entertainment - GA' }],
  ['travel_ga', { account: '64190', label: 'Travel - GA' }],
  ['fsi_global_ga', { account: '66500', label: 'FSI Global G&A' }],
  ['mileage', { account: '64190', label: 'Mileage reimbursement (IRS rate)' }],
];

export const CATEGORY_ACCOUNT_MAP: Record<string, CategoryAccountInfo> = CATEGORY_ACCOUNT_TUPLES.reduce(
  (accumulator, [category, info]) => {
    accumulator[category] = info;
    return accumulator;
  },
  {} as Record<string, CategoryAccountInfo>
);

export function lookupCategoryAccount(category: string): CategoryAccountInfo | null {
  if (!category) {
    return null;
  }

  const key = category.trim().toLowerCase();
  return CATEGORY_ACCOUNT_MAP[key] ?? null;
}
