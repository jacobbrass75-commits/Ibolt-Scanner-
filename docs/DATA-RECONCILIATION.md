# Mac catalog reconciliation — September 3, 2026 UTC

The original email attachment was downloaded privately and verified against the sender's SHA-256: `008eed6e79c0b3c73a635def723fb120462c00860652955a56848c9c0b824e93`. The export contains 612 product rows, 764 variant/part records, one historical test bin, and no saved counts. Its fresh SQLite snapshot contained no scoped inventory changes from the earlier September 3 checkpoint. Source product updates stop at August 26; Shopify quantities are not a live stock feed.

Reconciliation retains all 565 existing product IDs, their recorded weights and flags, and all 627 distinct Shopify variant IDs. It adds 135 entries, resulting in 700 catalog entries: 627 Shopify variants plus 73 workbook-only entries. Each source product ID remains in provenance. Earlier workbook associations are matched using their filename, sheet and source row evidence. Three new Shopify variants with SKUs 21199, 22201 and 21232 have no existing identity association to their workbook entries, so both records remain. These are catalog entries, not summed stock quantities.

Six pairs of Shopify variants share a SKU. Those variants remain distinct. Shared scanned codes return choices with descriptions and variant IDs. Printed barcode assignment still rejects new collisions; an existing shared barcode does not prevent saving a measured weight.

There are 131 imported reference weights, six weight flags, and 563 entries missing a part weight. All require physical verification before using them to calibrate bins. The extra PC flag is SKU 23519, whose workbook cell reads `1 lb 0.7 lbs`; the Mac parser interpreted it as 16 oz. That ambiguous text remains flagged. Shopify shipping weights are never component calibration.

The original test bin `IBOLT-TEST-21164` is preserved with its original ID, QR, timestamps and source values in the audit trail. Its status is archived because the 56 oz tare is an unverified legacy default. It cannot be counted. Create a new operational bin after weighing its empty container and a sample of parts.

Verification used a checksum-verified restored copy of the hosted database. The actual export import passed identity coverage, old-record and weight preservation, idempotency, SQLite integrity and foreign-key checks. Browser checks verified both shared-barcode and shared-SKU selection using Enter and Tab scanner suffixes. The import creates no synthetic counts. A production backup precedes migration; a new verified backup is copied to the PC afterward.

The remaining acceptance work is physical: connect the scanner, measure parts and empty bins, and check a hand-counted sample using `TESTING-TOMORROW.md`.
