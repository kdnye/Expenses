import React from 'react';

const PolicyReference = () => (
  <section className="card">
    <h2>Policy Quick Reference</h2>
    <details open>
      <summary>Travel &amp; transportation</summary>
      <ul>
        <li>Domestic airfare: book the lowest coach fare available. Upgrades are a personal expense.</li>
        <li>International airfare: business class only when the published flight time is eight hours or more.</li>
        <li>Use long-term parking when traveling 36+ hours. Mileage reimbursed at the IRS rate above base commute.</li>
        <li>Hotel gym fees reimbursable up to $15 per day.</li>
        <li>Laundry reimbursed only on trips longer than seven full days.</li>
      </ul>
    </details>
    <details>
      <summary>Meals &amp; entertainment</summary>
      <ul>
        <li>Receipts required for every meal. Without one, reimbursement is capped at $10 breakfast, $15 lunch, $25 dinner.</li>
        <li>Entertainment must be business-related where company business was discussed.</li>
      </ul>
    </details>
    <details>
      <summary>Non-reimbursable highlights</summary>
      <ul>
        <li>First-class airfare, personal entertainment, personal grooming, and traffic fines.</li>
        <li>Airline club dues, personal sundries, and theft of personal property (unless covered by rental insurance).</li>
      </ul>
    </details>
  </section>
);

export default PolicyReference;
