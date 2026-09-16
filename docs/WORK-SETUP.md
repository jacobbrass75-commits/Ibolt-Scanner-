# Set up inventory at work

Open **https://iboltscan.com** in Chrome or Safari and bookmark it. If the link opens inside an email app, open it in the browser first. Choose **Continue with Google**, or use your email address. If the app asks for an email code, check your inbox and spam folder and enter the code on the sign-in page. Email delivery, email-code sign-in, and Google sign-in on the new domain have been verified. See [current sign-in status](GOOGLE-SIGN-IN.md) for account-flow evidence.

This is the shared, hosted inventory app. It works from another computer with an internet connection; the home PC does not need to stay on. New operators can create their own account at `/sign-up`; no administrator approval is required. Use your own account each time. The migration keeps the old `nip.io` address as a redirect to the new domain so existing links and labels can continue to reach the same inventory; bookmark the new address directly.

Bring the scanner, its matching USB receiver, its original USB cable, a scale, an empty bin, and a few products with printed barcodes. Use your own Clerk account. The old `private/Inventory Login.txt` is a legacy recovery reference, not the current Clerk login. You can copy `Open Hosted Inventory.url` to the work PC as a shortcut.

No GitHub checkout, Node installation, database transfer, or local server is needed to use the hosted app. `localhost:5015` is only the home PC's hardware test page; it is not the address to use at work.

## Scanner connection and charging

The receiver detected on the home PC has USB ID `0581:011C`, listed as a Tera 5100 dongle in the [USB ID repository](https://usb-ids.gowdy.us/read/UD/0581/011c). Confirm the model on the handheld's sticker before scanning configuration codes: a receiver ID alone does not establish the exact handheld model or firmware.

For the Tera 5100, the [manufacturer's specifications](https://tera-digital.com/products/1d-barcode-scanner-5100) say it reads printed 1D barcodes, including Code 128. It cannot read QR codes or codes on a monitor. Print a striped test barcode or use a product's existing printed label. A phone camera can use the app's QR labels separately.

Tera's [5100 FAQ](https://m.media-amazon.com/images/I/B1sNXUSHDlL.pdf) says five beeps after a scan with no text arriving indicate low battery; three rapid beeps indicate a transmission or pairing problem. Charge the handheld using its original cable connected to a PC USB port. The receiver does not charge it. Test with the USB cable connected first to check a direct wired connection.

For wireless use, power on the charged scanner, plug its matching receiver into the work PC, and wait for the connection beep. The 5100 is factory-paired to its receiver and uses 2.4 GHz wireless, not Windows Bluetooth pairing. Keep the same handheld and receiver together.

If automatic pairing fails, use the **2.4GHz Wireless Pairing** section of the manual matching the sticker. Tera's current [5100 download](https://cdn.shopify.com/s/files/1/0144/3482/8374/files/D1HhEocLaCL.pdf?v=1731978798) is labeled **5100E**. For that manual, the pairing code is on printed page 7 (PDF page 11): unplug the receiver, scan the printed **Pairing** barcode, then reconnect the receiver. Do not apply this sequence or its programming codes to a different model without checking its manual.

Use **USB HID Keyboard**, **Real Time Mode**, and an **Enter / Carriage Return** suffix. In the current 5100E manual these are printed pages 8, 5, and 12 (PDF pages 12, 9, and 16). Print those pages to scan their settings. Avoid storage mode for interactive counting. There is no need to reset the scanner or erase stored scans for the first test.

## First test at work

1. Open the hosted URL in Chrome or Safari and sign in with Google or your email address. In **Scan & count**, click **Test scanner**, then click the scan input so the cursor is visible.
2. Scan a printed product barcode. The digits should arrive, including leading zeros. If digits arrive but submission does not happen, press Enter. An unknown catalog code still proves the scanner sent data.
3. If no digits arrive, test the same printed label in a blank Notepad window. A failure there also needs scanner, battery, receiver, or cable troubleshooting. A successful Notepad scan with no app input points to focus or suffix settings; return to the app, click its scan field, and retry.
4. Find the actual item in **Catalog & weights**. If necessary, assign its exact printed barcode. When a code has multiple matches, compare the description and variant before choosing.
5. Weigh a hand-counted sample of 10 identical unpackaged parts. Enter its total weight in ounces and sample size 10 to record the measured unit weight. Imported workbook weights are references, not verified measurements.
6. Create a bin using the measured empty-bin weight and a location. Exit **Test scanner**, scan the product's printed barcode again, and select the correct bin if there is more than one match. The current bin-label dialog generates QR labels, which the 5100 cannot scan; product-barcode lookup and bin selection work without those QR labels.
7. Put the same 10 parts into the empty bin, enter the gross scale weight and correct unit, then use **Preview count**. It should return 10. Check units, tare, packaging, and calibration before saving a real count. Scanner diagnostics and previews save no counts.
8. Save only a real, verified physical count. Confirm it appears in **Count history**. Scale readings are entered manually; the USB scanner does not read the scale.

All hosted users work on the same catalog and counts. Use your own account, and sign out when finished on a shared computer. Hourly server backups continue while the home PC is off; the existing additional backup copy to that PC resumes when it is online.

## Add a missing part or assembled kit

1. Search **Catalog & weights** first. When **Add part / kit** is available, open it and choose **Part** or **Assembled kit**. Enter the actual SKU/part number and description. Barcode and category are optional; keep leading zeros.
2. Leave an unknown weight blank. If you have measured one item without the bin, enter its weight, choose the scale's unit, add a measurement note and check the confirmation. For a kit, weigh one complete assembled kit.
3. Click **Add part** or **Add assembled kit**. Use **Set weight** if a measurement is still needed, then **Create bin** with the correct unit weight, measured empty-bin weight and location.
4. Scan the item and preview the actual bin's count before saving. Each assembled kit counts as one item; component inventory is not deducted automatically. Creating the catalog entry itself creates no bin or stock count.

See [Adding parts and assembled kits](ADDING-PARTS-AND-KITS.md) for the complete guide, duplicate-code handling and a practice checklist. Use actual inventory in the shared system; demonstration names and screenshot examples are made up.

## Source code

The repository is [jacobbrass75-commits/Ibolt-Scanner-](https://github.com/jacobbrass75-commits/Ibolt-Scanner-). GitHub contains source code and setup instructions, not the live inventory, passwords, or private exports. Pushing source does not move the operating database or change the hosted URL.
