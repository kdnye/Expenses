import React from 'react';
import ExpenseRow from './ExpenseRow.jsx';

const ExpensesTable = ({
  expenses,
  onAddExpense,
  onExpenseChange,
  onExpenseRemove,
  onReceiptFiles,
  getReceiptStatus,
}) => (
  <section className="card" id="expensesCard">
    <div className="card-header">
      <h2>Expenses</h2>
      <button id="addExpense" type="button" onClick={onAddExpense}>
        + Add expense
      </button>
    </div>
    <div className="table-scroll">
      <table id="expensesTable">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Type</th>
            <th scope="col">Account</th>
            <th scope="col">Description / Details</th>
            <th scope="col">Payment</th>
            <th scope="col">Amount</th>
            <th scope="col">Reimbursable</th>
            <th scope="col">Receipts</th>
            <th scope="col">Policy notes</th>
            <th scope="col" aria-label="Remove"></th>
          </tr>
        </thead>
        <tbody id="expensesBody">
          {expenses.map((expense) => (
            <ExpenseRow
              key={expense.id}
              expense={expense}
              onChange={(patch) => onExpenseChange(expense.id, patch)}
              onRemove={onExpenseRemove}
              onReceiptFiles={onReceiptFiles}
              receiptStatus={getReceiptStatus(expense)}
            />
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

export default ExpensesTable;
