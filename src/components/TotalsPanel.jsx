import React from 'react';
import { fmtCurrency } from '../utils.js';

const TotalsPanel = ({ totals }) => (
  <section className="card" id="totalsCard">
    <h2>Totals</h2>
    <dl className="totals">
      <div>
        <dt>Total submitted</dt>
        <dd id="totalSubmitted">{fmtCurrency(totals.submitted)}</dd>
      </div>
      <div>
        <dt>Due to employee</dt>
        <dd id="totalDueEmployee">{fmtCurrency(totals.employee)}</dd>
      </div>
      <div>
        <dt>Company card</dt>
        <dd id="totalCompanyCard">{fmtCurrency(totals.company)}</dd>
      </div>
    </dl>
  </section>
);

export default TotalsPanel;
