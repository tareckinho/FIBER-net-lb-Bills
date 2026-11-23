# Accounting workbook (0.1.22)

Main Admin opens **Accounting** from the sidebar in Main Office. Version 0.1.22 displays the worksheets retained by the installation's private view policy, in their original order. The current configured view contains **16 worksheets**. The installed original source remains intact, including sheets removed from the view. Other staff and business tabs cannot access this private workbook.

## Using the original worksheets

Choose the year and worksheet from the toolbar or the worksheet tabs. The grid preserves the original column names and order, cell values, number and date formats, fonts, colors, borders, row heights, column widths, merged cells, hidden rows and columns, and table filters. Scroll within the grid, use the cell address box to reach a cell, or change Zoom to inspect a wide sheet. The monthly sheets retain their original denomination-count columns as well as Total Amount and Balance.

Select an input cell and choose **Edit cell**. Choose Text, Number, Date or Blank cell, then save. Dates are entered as `YYYY-MM-DD` and retained as Excel serial values with the cell's original display format. Original formula cells and table headings are locked. For a merged input area, edit its first cell.

Saved input changes recalculate the original formulas on the server, including cross-sheet references. Formula text is parsed as a bounded spreadsheet expression; it is never executed as JavaScript. A formula error remains visible for review instead of being replaced by a saved cached number. The original formulas and formatting stay intact.

Use a table header's filter button to select the values to display. Filters update the worksheet view and its SUBTOTAL results. SUM retains Excel's all-row behavior. Filter choices do not change stored cell entries. **Clear filters** removes the current view filters.

For an edited input, **Restore original cell** returns that cell to its source value while retaining its edit history. Other cell changes remain saved. A restored cell can be edited again using its current revision.

## Private worksheet view policy

The operator can place `accounting-workbook-view.json` in the private server data directory. The server reads this file at startup. Its JSON object has exactly four fields:

| Field | Required value |
| --- | --- |
| `format` | `FIBERNETLB-ACCOUNTING-WORKBOOK-VIEW-1` |
| `year` | The installed workbook year, an integer from 2000 through 2099 |
| `sourceSha256` | The installed original XLSX source's 64-character hexadecimal SHA-256 |
| `excludedSheets` | An array of exact original worksheet names to remove from the view |

Keep this configuration private; actual worksheet selections do not belong in public source or examples. Use a bounded regular file, without symbolic or hard links, no larger than 64 KiB. Stop the server before applying a reviewed policy and restart it afterward. A malformed policy, mismatched year or source, an unknown or duplicate worksheet name, or a policy excluding every worksheet prevents startup.

Excluded worksheets are absent from the selector and cannot be opened or edited through Accounting. Their original cells, existing edits and immutable request history remain stored. Calculations still use the complete original workbook and saved input changes, so references from retained worksheets continue to work. Removing a worksheet from the view does not erase it or post a financial adjustment. When no policy file is present, the original installed worksheet selection is available.

## Backups and restoration

Encrypted backups include `accounting-workbook-view.json` when it is present, alongside the existing seven business databases and optional settings. The installed workbook snapshot and saved cell edits remain in Main. Keep the policy with the matching database backup and original server configuration.

Restore the private policy together with its matching databases before starting the restored server. The policy's year, source hash and worksheet names must match that restored workbook. Older archives without a policy remain supported; if the file is absent after restoration, the original worksheet selection is available. Reapply the intended reviewed policy before startup when that restricted view must be preserved. Restore remains an operator task; changing the policy does not restore or replace databases.

## Saving and recovery

Cell saves and restorations retain an original request reference, operator, revision and audit history. Concurrent edits require the current cell revision. The original XLSX file and installed source snapshot remain unchanged; saved changes are stored separately in the Main database and included in the existing seven-database backups.

If a response is lost, choose **Check saved result**. Finish saving an existing result, or review the exact original request before retrying it. No financial change is automatically replayed. Releasing a browser hold requires review and a second exact status check; it does not cancel a change that may already have been saved. Keep the original browser data until recovery is complete.

Worksheet edits belong to this independent Accounting workbook. Enter operational collections, payments and transfers through the existing business forms. Editing a worksheet cell does not post to customer bills, provider services, cash drawers, Whish wallets, Bank or the existing financial dashboards.

## Earlier normalized records

Where earlier normalized Accounting records already exist, their source provenance, revisions and request history remain stored. The original worksheet grid is the current interface; a view policy does not delete those earlier records or create a normalized import. Blank template rows are not converted into transactions. Original worksheets remain independent from operational financial postings.

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

## Website 0.1.22 historical behavior

Accounting → Bandwidth includes read-only monthly tables linked to saved operational bandwidth purchases. Date, saved supplier name, quantity with Mbps/Gbps, description, unit price and Payments appear automatically. Payments retains the workbook meaning of purchase cost; it is not supplier cash settlement. Each receipt appears once, including after refresh or an exact purchase retry.

The linked tables follow the original worksheet styling and expand past twenty purchases without moving existing cells. Each has its own exact receipt-cost total. Original Excel entries and totals stay intact because an imported entry may already describe the same purchase. No extra expense, supplier payment or cash movement is posted by viewing Accounting. Corrections belong to the original purchase workflow. Unsaved or damaged purchase sources stop the automatic view until the original result is checked.

## Historical future-only behavior (0.1.23)

New saved bandwidth purchases fill unused rows inside the original monthly Bandwidth tables. Their exact rounded purchase cost feeds the existing monthly totals, budget balance and supplier formulas, and the Accounting year summary. Original columns, table coordinates and imported values remain in place. The extra monthly tables from 0.1.22 are removed from the current view.

The owner chose to keep imported amounts and add only future purchases. A private, source-bound baseline identifies purchases already present when the link was configured; those receipts are not copied into the workbook. New receipt identities are added once, including after refresh or an exact retry. The private data directory's accounting-bandwidth-baseline.json records the year, workbook hash, cutover time and immutable receipt fingerprints. Restore it with the matching databases and workbook policy. It is included in encrypted backups when present. Without a matching baseline, the original manual workbook remains available and automatic linking is disabled.

Automatic cells and newly filled supplier-name placeholders are read-only. Existing input edits, saved-request recovery and recorded payments remain protected. If future receipts exceed a month's remaining rows, they are grouped by saved supplier name with an exact summed cost. Mixed quantities and prices remain blank in grouped rows; View new purchases shows every original receipt. The form reports an error if it cannot safely represent a supplier or fit its groups, instead of dropping receipts or overwriting manual records.

Payments retains the workbook meaning of purchase cost. Viewing or refreshing Accounting creates no extra expense, payment or cash movement. Unconfirmed saves and damaged source or baseline records stop automatic calculations until their original result is checked.

## Program bandwidth amounts in the original forms (0.1.24)

When enabled by the owner, saved program purchases replace the imported bandwidth amounts for each month that has program purchases. Date, Name, Quantity, Description, Unit Price and Payments occupy the original monthly table. Monthly supplier costs, remaining budget and the Accounting year summary recalculate from those exact purchase costs. Existing and future program purchases appear once. Months without program purchases retain their imported entries.

The private data directory's accounting-bandwidth-authority.json enables program_months mode for one year and immutable workbook source hash, and records its activation time. Restore it with the matching databases, workbook view policy and historical cutover baseline. Both private profiles accompany encrypted backups. A matching authority profile takes precedence over the earlier future-only baseline. Without either matching profile the manual imported workbook remains available.

Program-owned monthly input cells and the corresponding annual provider cost formulas are read-only. Original table geometry, styles and other accounting inputs are preserved. Saved edits remain in their original journal and exact saved-request recovery remains available; superseded bandwidth amount edits are omitted only from the current calculation. Supplier date and cash entries retain their original association. If receipt count exceeds the original rows, exact costs are grouped by saved supplier name and every receipt remains available in the detail view. A month that cannot be represented safely reports an error.

Payments means purchase cost. Viewing or refreshing Accounting does not create an expense, payment, purchase or cash movement. Durable source receipts must pass their original financial checks before being shown. The original workbook source is never rewritten by this display and calculation policy.
