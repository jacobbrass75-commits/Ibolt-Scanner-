# First scanner and scale test

1. Double-click **Start Inventory.cmd**, or open **https://inventory.89.167.10.34.nip.io**. Sign in with the account in the private PC file `private/Inventory Login.txt`. Use this hosted app for all new weights and counts.
2. Plug in the scanner. Set it to **USB keyboard / HID** mode with **Enter** or **Tab** after each scan, using its model-specific setup sheet.
3. Click **Test scanner**. Scan a real product label. The app shows exactly what the scanner sent, its length, suffix, and match count. This mode saves no inventory counts.
4. If the code is unknown, find the product in **Catalog & weights**. Assign its exact printed barcode, including leading zeros. Do not assign one barcode to two different parts. A SKU such as **21164** can also be typed to test the lookup.
5. Weigh a sample of 10 identical, unpackaged parts. In **Set weight**, enter the sample weight in ounces and sample size 10. Confirm and save the calculated part weight. The workbook's six flagged entries need this review before use.
6. Create a bin for that product. Measure its empty weight and enter its location. Check the two weights before creating the label. Print or download the QR label.
7. Return to **Scan & count** and scan the bin QR. Put the 10 hand-counted parts in the bin and weigh it. Enter the total and correct unit, then **Preview count**. The expected result is 10.
8. If the result differs, check the scale units, tare, part consistency, packaging, and scale precision. Correct the calibration before saving operational counts.
9. Save the count and check **Count history**. Export a CSV, then create a backup. Keep a copy off the server through your chosen private storage. The server also creates hourly backups on its own disk.

## Useful reference

The workbook lists SKU 21164, “Plastic 17mm AMPS Plate- Bulk,” at 0.4 oz per part. It is an imported reference weight, **not yet physically verified here**. A simulated example with 16 oz tare and 20 oz total returns 10 units; the software test used a separate disposable database.

## Current limitations

- The physical scanner and scale still need the hands-on checks above.
- The PC catalog is built from the available older Downloads database plus the workbook. The newer 612-product Mac snapshot and its existing bin still need private transfer and reconciliation.
- The Mac Tailscale hostname could not be resolved from this PC during setup. This local app does not depend on that hostname.
- Scale weights are entered manually. The app does not read a serial, Bluetooth, or USB scale directly.
- The PC catalog has been transferred to the existing Hetzner server using a verified backup. Its local predecessor remains preserved, but new operational counts belong in the hosted app.
