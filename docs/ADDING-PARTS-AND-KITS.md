# Adding parts and assembled kits

Open [iBOLT Scan](https://iboltscan.com), then use **Catalog & weights → Add part / kit** to enter a real item that is missing from the catalog. Operators and administrators can add items. Refresh an already-open page if the new button is missing.

An **assembled kit** is a complete kit that you store and count as one item. Its weight must be the weight of the complete assembled kit. Adding or counting a kit does not deduct parts from component inventory.

## Add the catalog entry

1. Search **Catalog & weights** for the part number or barcode first. Open an existing match rather than creating the same item again. Compare descriptions when an imported SKU has multiple variants.
2. Click **Add part / kit** and choose **Part** or **Assembled kit**.
3. Enter the **SKU / part number** and **Description**. Both are required. Use a distinct part number for a complete kit. Do not reuse the part number of one of its components.
4. Optionally enter its **Printed barcode** and **Category**. Keep every digit, including leading zeros. SKU scanning works even when no separate barcode is entered. Use the literal code printed on the label, rather than an inventory URL or scanner programming code.
5. Leave the weight blank if it has not been measured. The item will show **Needs weight**, and you can use **Set weight** later. Do not enter zero as a placeholder.
6. If you have measured one item without its bin, enter **One part weight** or **One complete kit weight**. Select the unit shown by the scale: ounces, pounds, grams or kilograms. Check the converted weight displayed in ounces, enter a **Measurement note**, and check the confirmation. Describe what was weighed, including any packaging that remains with each item.
7. Review the fields and click **Add part** or **Add assembled kit**. The catalog filters to the saved part number and offers **Set weight** and **Create bin**.

The weight in the creation form is for **one** item. To calibrate using several identical items, leave it blank here and use **Set weight** after creation. For example, a hand-counted sample of complete kits must use the number of complete kits as its sample size.

Creating an item adds its catalog identity and any measured weight. It does not create a bin or save a stock count.

## Prepare a bin and count real stock

1. If needed, click **Set weight**. Weigh one or several identical items without the container, enter the combined sample weight in ounces and the number of items in the sample, then confirm and save. For an assembled kit, every item in the sample must be a complete kit.
2. Click **Create bin**. Check the item, give the bin a recognizable label and location, and enter the measured unit weight and empty-bin weight in ounces. Use an empty-bin weight of zero only when the scale has already been tared for that container. Confirm the weights and create the bin.
3. In **Scan & count**, scan the bin label or exact product barcode/SKU. Select the correct physical bin if there are multiple matches. A USB scanner needs a barcode type that its model can read; a successful scanner input test does not by itself verify the weight calculation.
4. Enter the full bin's scale reading and the correct unit. Use **Preview count** and check that the quantity is reasonable. The calculation subtracts the empty-bin weight and divides the remaining weight by the unit weight.
5. Save only a real, verified physical count, then confirm the entry in **Count history**. The count records the weights, operator and time. Changes to the catalog weight do not automatically change an existing bin's calibration.

For a practice check, place a known quantity in an empty bin and preview the result. Do not save that practice quantity as warehouse stock. Use a disposable local database for made-up items and saved practice counts. Demonstration screenshots and example names are made up; they are not operational catalog entries.

## If an entry is rejected

- **Part number already exists:** search for the existing item. Use a different part number only when this is a distinct item, such as a complete kit rather than an individual component.
- **Barcode or part number belongs to another item or bin:** check the printed label and catalog match. A new entry cannot take over an existing product code, alias or bin code.
- **Weight or measurement note is missing:** either leave the optional weight blank or supply a positive measurement, its unit and a note, then confirm it.
- **Connection error:** keep the form open and retry the same entry. An unchanged request is safe to retry. If you closed the form after an uncertain result, search the catalog before adding it again.

The shared catalog is available to all signed-in warehouse users. Continue to use your own account and the normal [work setup](WORK-SETUP.md). This feature does not change sign-in or Shopify inventory.
