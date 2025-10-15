import React from 'react';

const ReportPreview = ({
  preview,
  onCopy,
  onSubmit,
  copyFeedback,
  submissionFeedback,
  submitting,
}) => (
  <section className="card">
    <h2>Report Preview</h2>
    <p className="hint">Snapshot updates automatically and reflects exactly what will be submitted for approval.</p>
    <textarea id="reportPreview" readOnly rows={12} aria-label="Expense report preview" value={preview} />
    <button id="copyPreview" type="button" onClick={onCopy} disabled={submitting}>
      Copy summary
    </button>
    <button id="finalizeSubmit" type="button" onClick={onSubmit} disabled={submitting}>
      {submitting ? 'Submitting…' : 'Finalize & submit'}
    </button>
    <p
      className="copy-feedback"
      id="submissionFeedback"
      role="status"
      aria-live="polite"
      data-variant={submissionFeedback.variant}
    >
      {submissionFeedback.message}
    </p>
    <p className="copy-feedback" id="copyFeedback" role="status" aria-live="polite">
      {copyFeedback}
    </p>
  </section>
);

export default ReportPreview;
