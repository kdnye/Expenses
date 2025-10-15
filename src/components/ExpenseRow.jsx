import React from 'react';
import { EXPENSE_TYPES, IRS_RATE } from '../constants.js';
import { fmtCurrency, formatFileSize } from '../utils.js';

const PAYMENT_OPTIONS = [
  { value: 'personal', label: 'Personal funds' },
  { value: 'company', label: 'Company card' },
];

const MEAL_OPTIONS = [
  { value: 'breakfast', label: 'Breakfast ($10 cap w/out receipt)' },
  { value: 'lunch', label: 'Lunch ($15 cap w/out receipt)' },
  { value: 'dinner', label: 'Dinner ($25 cap w/out receipt)' },
];

const TRAVEL_CATEGORY_OPTIONS = [
  { value: 'air_domestic', label: 'Airfare – Domestic' },
  { value: 'air_international', label: 'Airfare – International' },
  { value: 'lodging', label: 'Lodging / Hotel' },
  { value: 'parking', label: 'Parking / Tolls' },
  { value: 'ground', label: 'Ground transport (taxi, rideshare, shuttle)' },
  { value: 'laundry', label: 'Laundry / Dry cleaning' },
  { value: 'gym', label: 'Hotel gym' },
  { value: 'other', label: 'Other travel' },
];

const TRAVEL_CLASS_OPTIONS = [
  { value: 'coach', label: 'Coach' },
  { value: 'premium', label: 'Premium economy' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First' },
];

const ExpenseRow = ({ expense, onChange, onRemove, onReceiptFiles, receiptStatus }) => {
  const showMealDetails = expense.policy === 'meal';
  const showMileageDetails = expense.policy === 'mileage';
  const showTravelDetails = expense.policy === 'travel';
  const showFlightOnly =
    showTravelDetails &&
    (expense.travelCategory === 'air_domestic' || expense.travelCategory === 'air_international');

  const handleInputChange = (key) => (event) => {
    const { value } = event.target;
    onChange({ [key]: value });
  };

  const handleNumberChange = (key) => (event) => {
    const value = event.target.value;
    onChange({ [key]: value === '' ? '' : Number(value) });
  };

  const handleAmountChange = (event) => {
    onChange({ amount: event.target.value === '' ? '' : Number(event.target.value) });
  };

  const handleReceiptToggle = (event) => {
    onChange({ hasReceipt: event.target.checked });
  };

  const handleReceiptFiles = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    onReceiptFiles(expense.id, files);
  };

  const receiptMessage = receiptStatus?.message || '';
  const receiptStatusValue = receiptStatus?.status || 'info';

  return (
    <tr className="expense-row">
      <td>
        <input type="date" value={expense.date || ''} onChange={handleInputChange('date')} className="exp-date" />
      </td>
      <td>
        <select value={expense.type} onChange={handleInputChange('type')} className="exp-type">
          {EXPENSE_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label} ({type.account})
            </option>
          ))}
        </select>
        <div className="detail" data-detail="meal" hidden={!showMealDetails}>
          <label>
            Meal type
            <select value={expense.mealType} onChange={handleInputChange('mealType')} className="exp-meal-type">
              {MEAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={expense.hasReceipt !== false} onChange={handleReceiptToggle} className="exp-receipt" />
            Receipt provided
          </label>
        </div>
        <div className="detail" data-detail="mileage" hidden={!showMileageDetails}>
          <label>
            Miles driven
            <input
              type="number"
              min="0"
              step="0.1"
              value={expense.miles ?? ''}
              onChange={handleNumberChange('miles')}
              className="exp-miles"
            />
          </label>
          <p className="hint">Reimbursed at current IRS rate.</p>
        </div>
        <div className="detail" data-detail="travel" hidden={!showTravelDetails}>
          <label>
            Travel category
            <select value={expense.travelCategory} onChange={handleInputChange('travelCategory')} className="exp-travel-cat">
              {TRAVEL_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label data-flight-only hidden={!showFlightOnly}>
            Class of service
            <select value={expense.travelClass} onChange={handleInputChange('travelClass')} className="exp-travel-class">
              {TRAVEL_CLASS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label data-flight-only hidden={!showFlightOnly}>
            Published flight hours
            <input
              type="number"
              min="0"
              step="0.1"
              value={expense.flightHours ?? ''}
              onChange={handleNumberChange('flightHours')}
              className="exp-flight-hours"
              placeholder="0"
            />
          </label>
        </div>
      </td>
      <td className="expense-account">{expense.account || '—'}</td>
      <td>
        <textarea
          className="exp-description"
          rows={2}
          placeholder="Describe the business purpose"
          value={expense.description || ''}
          onChange={handleInputChange('description')}
        />
      </td>
      <td>
        <select value={expense.payment} onChange={handleInputChange('payment')} className="exp-payment">
          {PAYMENT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="number"
          min="0"
          step="0.01"
          value={
            showMileageDetails
              ? expense.amount ?? ''
              : expense.amount && expense.amount !== 0
                ? expense.amount
                : ''
          }
          onChange={handleAmountChange}
          className={`exp-amount${showMileageDetails ? ' readonly' : ''}`}
          placeholder="0.00"
          readOnly={showMileageDetails}
        />
        <div className="detail" data-detail="mileage" hidden={!showMileageDetails}>
          <span className="mileage-rate">IRS rate ${IRS_RATE.toFixed(3)} per mile</span>
        </div>
      </td>
      <td className="expense-reimbursable">{fmtCurrency(expense.reimbursable || 0)}</td>
      <td className="receipt-cell">
        <label className="receipt-input">
          <span>Attach receipt</span>
          <span className="sr-only"> for this expense</span>
          <input
            type="file"
            className="exp-receipt-files"
            accept="image/*,application/pdf"
            multiple
            onChange={handleReceiptFiles}
          />
        </label>
        <div className="receipt-status" data-status={receiptStatusValue} aria-live="polite">
          {receiptMessage}
        </div>
        <ul className="receipt-list">
          {(expense.receipts || []).map((receipt) => {
            const sizeLabel = formatFileSize(receipt.fileSize);
            const label = `${receipt.fileName || 'Receipt'}${sizeLabel ? ` (${sizeLabel})` : ''}`;
            return (
              <li key={receipt.id || receipt.storageKey || receipt.fileName}>
                {receipt.downloadUrl ? (
                  <a href={receipt.downloadUrl} target="_blank" rel="noopener noreferrer">
                    {label}
                  </a>
                ) : (
                  <span>{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      </td>
      <td>
        <ul className="policy-messages">
          {(expense.messages || []).map((message, index) => (
            <li key={index} className={message.type}>
              {message.text}
            </li>
          ))}
        </ul>
      </td>
      <td>
        <button type="button" className="remove-expense" title="Remove" onClick={() => onRemove(expense.id)}>
          &times;
        </button>
      </td>
    </tr>
  );
};

export default ExpenseRow;
