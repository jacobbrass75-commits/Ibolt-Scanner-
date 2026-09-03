# Set up inventory at work

Open **https://inventory.89.167.10.34.nip.io** and bookmark it. This is the shared, hosted inventory app. It works from another computer with an internet connection; the home PC does not need to stay on. The custom Cloudflare domain is not active yet.

Bring the scanner, its matching USB receiver, its original USB cable, a scale, an empty bin, and a few products with printed barcodes. Have your inventory login available privately. On the configured home PC it is in `private/Inventory Login.txt`; that file is not in GitHub. You can copy `Open Hosted Inventory.url` to the work PC as a shortcut.

No GitHub checkout, Node installation, database transfer, or local server is needed to use the hosted app. `localhost:5015` is only the home PC's hardware test page; it is not the address to use at work.

## Scanner connection and charging

The receiver detected on the home PC has USB ID `0581:011C`, listed as a Tera 5100 dongle in the [USB ID repository](https://usb-ids.gowdy.us/read/UD/0581/011c). Confirm the model on the handheld's sticker before scanning configuration codes: a receiver ID alone does not establish the exact handheld model or firmware.

For the Tera 5100, the [manufacturer's specifications](https://tera-digital.com/products/1d-barcode-scanner-5100) say it reads printed 1D barcodes, including Code 128. It cannot read QR codes or codes on a monitor. Print a striped test barcode or use a product's existing printed label. A phone camera can use the app's QR labels separately.

Tera's [5100 FAQ](https://m.media-amazon.com/images/I/B1sNXUSHDlL.pdf) says five beeps after a scan with no text arriving indicate low battery; three rapid beeps indicate a transmission or pairing problem. Charge the handheld using its original cable connected to a PC USB port. The receiver does not charge it. Test with the USB cable connected first to check a direct wired connection.

For wireless use, power on the charged scanner, plug its matching receiver into the work PC, and wait for the connection beep. The 5100 is factory-paired to its receiver and uses 2.4 GHz wireless, not Windows Bluetooth pairing. Keep the same handheld and receiver together.

If automatic pairing fails, use the **2.4GHz Wireless Pairing** section of the manual matching the sticker. Tera's current [5100 download](https://cdn.shopify.com/s/files/1/0144/3482/8374/files/D1HhEocLaCL.pdf?v=1731978798) is labeled **5100E**. For that manual, the pairing code is on printed page 7 (PDF page 11): unplug the receiver, scan the printed **Pairing** barcode, then reconnect the receiver. Do not apply this sequence or its programming codes to a different model without checking its manual.

Use **USB HID Keyboard**, **Real Time Mode**, and an **Enter / Carriage Return** suffix. In the current 5100E manual these are printed pages 8, 5, and 12 (PDF pages 12, 9, and 16). Print those pages to scan their settings. Avoid storage mode for interactive counting. There is no need to reset the scanner or erase stored scans for the first test.

## First test at work

1. Open the hosted URL and sign in. In **Scan & count**, click **Test scanner**, then click the scan input so the cursor is visible.
2. Scan a printed product barcode. The digits should arrive, including leading zeros. If digits arrive but submission does not happen, press Enter. An unknown catalog code still proves the scanner sent data.
3. If no digits arrive, test the same printed label in a blank Notepad window. A failure there also needs scanner, battery, receiver, or cable troubleshooting. A successful Notepad scan with no app input points to focus or suffix settings; return to the app, click its scan field, and retry.
4. Find the actual item in **Catalog & weights**. If necessary, assign its exact printed barcode. When a code has multiple matches, compare the description and variant before choosing.
5. Weigh a hand-counted sample of 10 identical unpackaged parts. Enter its total weight in ounces and sample size 10 to record the measured unit weight. Imported workbook weights are references, not verified measurements.
6. Create a bin using the measured empty-bin weight and a location. Exit **Test scanner**, scan the product's printed barcode again, and select the correct bin if there is more than one match. The current bin-label dialog generates QR labels, which the 5100 cannot scan; product-barcode lookup and bin selection work without those QR labels.
7. Put the same 10 parts into the empty bin, enter the gross scale weight and correct unit, then use **Preview count**. It should return 10. Check units, tare, packaging, and calibration before saving a real count. Scanner diagnostics and previews save no counts.
8. Save only a real, verified physical count. Confirm it appears in **Count history**. Scale readings are entered manually; the USB scanner does not read the scale.

All hosted users work on the same catalog and counts. Use your own account, and sign out when finished on a shared computer. Hourly server backups continue while the home PC is off; the existing additional backup copy to that PC resumes when it is online.

## Source code

The repository is [jacobbrass75-commits/Ibolt-Scanner-](https://github.com/jacobbrass75-commits/Ibolt-Scanner-). GitHub contains source code and setup instructions, not the live inventory, passwords, or private exports. Pushing source does not move the operating database or change the hosted URL.
