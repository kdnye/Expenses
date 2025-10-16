import React from 'react';

const FIELDS = [
  { key: 'name', label: 'Name', type: 'text', placeholder: 'Employee name', autoComplete: 'name' },
  { key: 'email', label: 'Email', type: 'email', placeholder: 'name@example.com', autoComplete: 'email' },
  {
    key: 'managerEmail',
    label: 'Manager email',
    type: 'email',
    placeholder: 'manager@example.com',
    autoComplete: 'email',
  },
  { key: 'department', label: 'Department', type: 'text', placeholder: 'Department or team' },
  { key: 'focus', label: 'Expense Type / Focus', type: 'text', placeholder: 'e.g., Mileage & supplies' },
  { key: 'purpose', label: 'Purpose of Trip / Project', type: 'text', placeholder: 'Client visit, project, etc.' },
  { key: 'je', label: 'JE Number', type: 'text', placeholder: 'Optional journal entry #' },
  { key: 'dates', label: 'Date Range', type: 'text', placeholder: 'e.g., Dec 4–7 2023' },
  {
    key: 'tripLength',
    label: 'Trip Length (days)',
    type: 'number',
    placeholder: '0',
    inputMode: 'numeric',
    min: 0,
    step: 1,
  },
];

const HeaderForm = ({ header, onChange }) => {
  const handleChange = (field) => (event) => {
    const { type } = field;
    const rawValue = event.target.value;
    if (type === 'number') {
      onChange(field.key, rawValue === '' ? '' : Number(rawValue));
    } else {
      onChange(field.key, rawValue);
    }
  };

  return (
    <section className="card">
      <h2>Report Header</h2>
      <div className="grid">
        {FIELDS.map((field) => {
          const value = header[field.key];
          const inputValue = field.type === 'number' ? (value === '' || value === undefined ? '' : value) : value ?? '';
          return (
            <label key={field.key}>
              {field.label}
              <input
                type={field.type}
                value={inputValue}
                placeholder={field.placeholder}
                onChange={handleChange(field)}
                autoComplete={field.autoComplete}
                inputMode={field.inputMode}
                min={field.min}
                step={field.step}
              />
            </label>
          );
        })}
      </div>
    </section>
  );
};

export default HeaderForm;
