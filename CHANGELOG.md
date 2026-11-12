# Changelog

All notable changes to `kempo-inventory-barcodes` are documented in this file.

## [Unreleased]

### Changed

- The SDK sends its requests through kempo's shared request layer (`/kempo/fetch.js`), so repeated reads are shared. Requires kempo 4.13.0 or later.

### Changed

- **Label text is a format.** The setting `label_format` (default `{name}`) builds the text above each barcode from the item's attributes, by their labels: `{attribute:brand}`, `{attribute:finish}`, `{attribute:manufacturer-code}`, plus `{name}`, `{sku}` and `{category}`. An attribute the item does not have is left out with its dash. The former `label_template` name is not used in a release.
- **An item's SKU is always one of its barcodes**, whatever it is. A scanned code that is not a UPC/EAN (an Amazon FNSKU, say) is kept as a "scanned" code and printed in Code 128. A made-up code is only created when the SKU is another item's code.
- **The Barcodes tab lists every category**, including ones with no items yet, so a category can be given its label format before it has items.
- **Label formats are chosen per item and per category** (item, then category, then the site default). A format can fall back to another attribute or to text, `{attribute:finish|"No finish"}`. The site default is now `{name}`.
- **Barcodes is a tab** on the inventory admin page (per-category formats) and on each item (its codes, label and format). Items get their tabs from the `inventory-item-tabs` location, on the admin item page and the site item page.
- **The Barcodes settings are a Settings tab** on the extension's admin page (Admin > Barcodes > Settings), no longer a tab on the Settings screen.

## [0.1.0] - 2026-11-09

First release. Requires kempo 4.11.0 and kempo-inventory 0.5.0 or later.

### Added

- **Several barcodes per item, one primary.** Add the real UPC to an item that has a made-up code, make it primary, and every label already on a bin keeps working. A scan of any code opens the item; all-digit codes match with or without a leading zero.
- **Made-up codes** (`INV-000123`) for items that have no barcode, numbered from one counter.
- **Merging** two items that turn out to be one: codes, SKU, print sheet lines and quantity move to the item that stays, and the other is deleted. Offered when adding a code another item already has.
- **Print sheets**, kept on the server and owned by the person who made them, so they can be built on a phone and printed on the computer. Each line has a number of copies, an item-name toggle and the code to print. The print page lays out as many labels as fit on the paper, onto as many pages as needed, with cut guides.
- **Settings** for the paper size, margin, label size and gap, the name's text size, cut guides and the made-up code prefix.
- **Existing barcodes**: gives every item whose SKU is a real product code a barcode of the same number.
- Pages for signed-in people at `/inventory-barcodes/`, an admin page and settings tab, and a Barcodes section on kempo-inventory's admin item page (through its `inventory-item-sections` location).
- A lookup route and server SDK for a site's own scanner.
- A deleted account takes its print sheets with it (the `user:deleted` hook), and a deleted item takes its barcodes and sheet lines (`kempo-inventory:item:deleted`).
