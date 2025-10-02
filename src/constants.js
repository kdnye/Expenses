export const STORAGE_KEY = 'fsi-expense-state-v2';
export const IRS_RATE = 0.655; // 2023 IRS standard mileage rate per mile.

export const MEAL_LIMITS = Object.freeze({
  breakfast: 10,
  lunch: 15,
  dinner: 25,
});

export const EXPENSE_TYPES = Object.freeze([
  { value: 'maintenance_repairs', label: 'Maintenance & Repairs', account: '51020', policy: 'default' },
  { value: 'parking_storage_cogs', label: 'Parking & Storage - COGS', account: '51070', policy: 'travel', travelDefault: 'parking' },
  { value: 'vehicle_supplies', label: 'Vehicle Supplies', account: '51090', policy: 'default' },
  { value: 'state_permits', label: 'State Permits / Fees / Tolls', account: '52030', policy: 'travel', travelDefault: 'other' },
  { value: 'meals_cogs', label: 'Meals & Entertainment - COGS', account: '52070', policy: 'meal' },
  { value: 'travel_cogs', label: 'Travel - COGS', account: '52080', policy: 'travel', travelDefault: 'air_domestic' },
  { value: 'fsi_global_overhead', label: 'FSI Global Overhead', account: '56000', policy: 'default' },
  { value: 'telephone_ga', label: 'Telephone - GA', account: '62000', policy: 'default' },
  { value: 'utilities', label: 'Utilities', account: '62070', policy: 'default' },
  { value: 'it_computer', label: 'IT / Computer', account: '62080', policy: 'default' },
  { value: 'office_supplies', label: 'Office Supplies', account: '62090', policy: 'default' },
  { value: 'printing_postage', label: 'Printing & Postage', account: '62100', policy: 'default' },
  { value: 'meals_ga', label: 'Meals & Entertainment - GA', account: '64180', policy: 'meal' },
  { value: 'travel_ga', label: 'Travel - GA', account: '64190', policy: 'travel', travelDefault: 'air_domestic' },
  { value: 'fsi_global_ga', label: 'FSI Global G&A', account: '66500', policy: 'default' },
  { value: 'mileage', label: 'Mileage reimbursement (IRS rate)', account: '64190', policy: 'mileage' },
]);

export const DEFAULT_STATE = Object.freeze({
  header: {
    name: '',
    department: '',
    focus: '',
    purpose: '',
    je: '',
    dates: '',
    tripLength: '',
    email: '',
    managerEmail: '',
  },
  expenses: [],
  history: [],
  meta: {
    draftId: null,
    lastSavedMode: 'draft',
    lastSavedAt: null,
  },
});

export const headerBindings = Object.freeze({
  field_name: 'name',
  field_department: 'department',
  field_focus: 'focus',
  field_purpose: 'purpose',
  field_je: 'je',
  field_dates: 'dates',
  field_trip_length: 'tripLength',
  field_email: 'email',
  field_manager_email: 'managerEmail',
});

export const cloneDefaultState = () => JSON.parse(JSON.stringify(DEFAULT_STATE));
