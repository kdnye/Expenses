# FSI Expense Report Builder

A lightweight web application for preparing Freight Services expense reports with built-in policy validation.

## Features
- Persist report header details and expense rows locally.
- Inline policy reminders for travel, meals, and mileage reimbursements.
- Automatic reimbursement calculations for capped categories and mileage at the IRS rate.
- Copy-ready text preview that mirrors the official expense form layout.

## Getting started
1. Serve the project with any static HTTP server (for example `python -m http.server 8000`).
2. Open the site in your browser and start adding expenses.
3. Copy the generated preview text into the company expense template when you are done.

Local storage persistence is optional; if the browser disables access, the app still functions without saving state between sessions.
