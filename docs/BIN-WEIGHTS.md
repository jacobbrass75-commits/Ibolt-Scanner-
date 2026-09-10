# Importing bin-weight worksheets

**Bin weights** displays every supplied bin measurement with its original worksheet row, cell, part number, and units. Open it from the sidebar or `/?view=bin-weights`.

The worksheet format is `Part`, `Part (oz)`, and `Bin N (Lbs)`. Numeric part weights mean ounces; explicit pound-and-ounce strings are converted to ounces. Bin columns contain pounds. Blank cells remain missing, while an explicit zero remains a measurement. Duplicate part-number rows remain separate entries.

## Preview and apply

Keep the original attachment and all preview reports outside Git, in a protected private directory. Run against the standalone inventory database, never the original legacy database.

```sh
npm run import:bin-weights -- /private/weights.xlsx \
  --database /path/to/inventory.sqlite \
  --source-note 'Sender, email subject, received date, and message reference'
```

The preview reports matches, ambiguous and missing part numbers, changed part weights, and preserved verified weights. Review it before applying. Use the same source note and the two hashes returned by the preview:

```sh
npm run import:bin-weights -- /private/weights.xlsx \
  --database /path/to/inventory.sqlite \
  --source-note 'Sender, email subject, received date, and message reference' \
  --apply --expect-source SOURCE_SHA256 --expect-plan PLAN_SHA256
```

The compiled server command is `node dist/scripts/import-bin-weights.js` with the same arguments. It creates a verified online backup before schema migration or import. A changed source, stale catalog preview, or invalid cell prevents application. Importing the same file again does not duplicate records.

## Part weights and catalog matches

Only a unique exact SKU or alias match can update a catalog part. Verified local weights retain their values and status. Newer unverified reference weights can replace older reference weights with before/after audit records and source provenance. Conflicting weights for repeated part numbers remain unresolved. Existing bins retain their own calibration and existing count snapshots are unchanged.

Missing or ambiguous catalog matches stay visible under **Needs catalog match**. An operator must identify the correct catalog item before setting up its bin. No fuzzy match or new product identity is inferred.

## Preparing operational bins

The sheet format does not establish container tare, whether the listed weight includes the container, a physical location, or a count timestamp. Importing it therefore records source measurements and does not create quantities or operational bins automatically.

Choose **Set up bin**, confirm the catalog item and unit weight, enter the measured empty-bin weight in ounces, and confirm the calibration. Each source measurement can create one bin. The bin's notes retain the source reference; the source measurement is preserved and linked to that bin. Use **Scan & count** for a fresh scale reading and a current physical count.

All reads use the application's existing authentication. Viewers can review measurements; only operators and administrators can create bins. Shopify remains read-only.

## Deployment and recovery

Schema 4 adds the `bin_weights` table and includes its totals in new backup manifests. Build and test the release separately, take a verified backup, then migrate the operating database during the inventory service cutover. Upgrade the backup tools with the application, including the PC's compiled backup-pull script (`npm run build`). A rollback to schema-3 code requires its matching pre-import backup; never point older code at the schema-4 operating database or overwrite newer operating records.

Tests cover unit parsing, missing and zero values, duplicate source rows, ambiguous identities, verified calibration preservation, stale previews, replay protection, authenticated setup, and unchanged count history. Browser QA must use a disposable database on its own port.
