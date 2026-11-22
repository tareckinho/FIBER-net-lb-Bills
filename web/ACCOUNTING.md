# Accounting workbook (0.1.20)

Main Admin opens **Accounting** from the sidebar in Main Office. Version 0.1.20 displays the supplied workbook's 25 original worksheets in their original order, including the monthly sheets, Accounting, Bandwidth, Bandwidth Resellers, Loan, project sheets, office plans and solar calculations. Other staff and business tabs cannot access this private workbook.

## Using the original worksheets

Choose the year and worksheet from the toolbar or the worksheet tabs. The grid preserves the original column names and order, cell values, number and date formats, fonts, colors, borders, row heights, column widths, merged cells, hidden rows and columns, and table filters. Scroll within the grid, use the cell address box to reach a cell, or change Zoom to inspect a wide sheet. The monthly sheets retain their original denomination-count columns as well as Total Amount and Balance.

Select an input cell and choose **Edit cell**. Choose Text, Number, Date or Blank cell, then save. Dates are entered as `YYYY-MM-DD` and retained as Excel serial values with the cell's original display format. Original formula cells and table headings are locked. For a merged input area, edit its first cell.

Saved input changes recalculate the original formulas on the server, including cross-sheet references. Formula text is parsed as a bounded spreadsheet expression; it is never executed as JavaScript. A formula error remains visible for review instead of being replaced by a saved cached number. The original formulas and formatting stay intact.

Use a table header's filter button to select the values to display. Filters update the worksheet view and its SUBTOTAL results. SUM retains Excel's all-row behavior. Filter choices do not change stored cell entries. **Clear filters** removes the current view filters.

For an edited input, **Restore original cell** returns that cell to its source value while retaining its edit history. Other cell changes remain saved. A restored cell can be edited again using its current revision.

## Saving and recovery

Cell saves and restorations retain an original request reference, operator, revision and audit history. Concurrent edits require the current cell revision. The original XLSX file and installed source snapshot remain unchanged; saved changes are stored separately in the Main database and included in the existing seven-database backups.

If a response is lost, choose **Check saved result**. Finish saving an existing result, or review the exact original request before retrying it. No financial change is automatically replayed. Releasing a browser hold requires review and a second exact status check; it does not cancel a change that may already have been saved. Keep the original browser data until recovery is complete.

Worksheet edits belong to this independent Accounting workbook. Enter operational collections, payments and transfers through the existing business forms. Editing a worksheet cell does not post to customer bills, provider services, cash drawers, Whish wallets, Bank or the existing financial dashboards.

## Earlier normalized records

The reviewed local dataset retains its earlier 416 normalized Accounting records and their source filename, sheet, row, SHA-256, revisions and request history. The original worksheet grid is the current interface; those earlier records remain available to the existing accounting register API for audit and recovery. Blank template rows are not converted into transactions. Office plans and solar calculations are shown in their original worksheets rather than being converted into financial postings.

## Private local review

The loopback helper uses a separate persistent private dataset. It refuses an existing installation without its own ownership marker, disables external providers and automatic month closing, and binds only to `127.0.0.1`.

Install the reviewed private workbook snapshot when opening the dataset:

```sh
node tools/accounting-local.cjs --data-directory ABSOLUTE_PRIVATE_DIRECTORY --workbook ABSOLUTE_PRIVATE_WORKBOOK_JSON --port 3811
```

`--workbook` requires an absolute path to a prepared private JSON snapshot with format `FIBERNETLB-ACCOUNTING-WORKBOOK-1`, a year, the source XLSX SHA-256, original worksheets and formatting metadata. The selected year's source is installed once and stored as an immutable compressed snapshot in the Main database. Supplying the same source again preserves the installed copy. A different source cannot replace that year through this helper; changing an installed source requires a separately reviewed migration.

The optional `--import ABSOLUTE_PREPARED_IMPORT_JSON` argument also loads a reviewed normalized register batch. Its format is `FIBERNETLB-ACCOUNTING-IMPORT-1`; the helper verifies source identity, saved results and record counts, and reconciles annual ledger totals when the companion preparation report is present. Repeating an exact import reuses its original request identities. The normalized import and original worksheet snapshot serve separate purposes.

The helper prints the local URL and generates a dedicated administrator login stored in the private directory. Keep that login private and do not reuse it for production or public hosting. Keep the XLSX file, prepared JSON files, databases, keys, credentials and backups outside public assets and source exports.

Stop the helper with Ctrl+C. Restart with the same data directory and port, without `--workbook` or `--import`, to reopen the installed workbook and saved cell edits:

```sh
node tools/accounting-local.cjs --data-directory ABSOLUTE_PRIVATE_DIRECTORY --port 3811
```

This local review does not deploy or migrate an operating production server. Production deployment requires the owner's existing configuration, keys and data and a separately reviewed import.

## Verification

The focused checks use synthetic workbooks and temporary databases, with external providers disabled:

```sh
node --test --test-isolation=none test/accounting-workbook-http.test.cjs
node tools/accounting-workbook-browser-check.cjs --output-directory validation/accounting-workbook
```

The browser check requires Chrome or Chromium; set `CHROME_BIN` to its executable when automatic discovery is unavailable. It checks worksheet layout, locked headers and formulas, safe input rendering, filters, recalculation, recovery, persistence and permission scope. Private workbook contents are excluded from these public test fixtures and source packages.
