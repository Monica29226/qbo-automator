---
name: Bank Statement Import Module
description: Module for importing bank statements, normalizing transactions, and generating QBO Banking-compatible CSV files
type: feature
---
## Tables
- `bank_import_configs`: Per-org bank configuration (bank_name, currency, date_format, amount_layout, OneDrive folders)
- `bank_import_sources`: Parser definitions with column_mapping JSON per bank/file type
- `bank_import_jobs`: File processing jobs with status tracking (PENDING→PROCESSING→PROCESSED→ERROR)
- `bank_import_job_items`: Normalized transaction rows (date, reference, description, money_in, money_out)
- `onedrive_subscriptions`: Microsoft Graph webhook subscriptions per org

## Parsers
- DEBIT_CREDIT_COLUMNS: Layout Fecha, Documento, Debe, Haber, Descripción
- SINGLE_SIGNED_AMOUNT: Layout Date, Description, Amount (positive=in, negative=out)

## QBO CSV Output
3-column format: Date (MM/DD/YYYY), Description, Amount (positive=deposit, negative=withdrawal)
Stored in company-documents bucket at `bank-csv/{org_id}/{job_id}_qbo.csv`

## Edge Function
`process-bank-statement` with actions: process_csv_content, generate_qbo_csv, reprocess_job

## UI
Route: /bank-statements with tabs for Jobs list and Configuration
Components in src/components/bank/

## OneDrive Integration
Requires Microsoft OneDrive connector (not yet linked). Currently supports manual CSV upload.
