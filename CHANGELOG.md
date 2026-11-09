# Changelog

All notable changes to `kempo-inventory-barcodes` are documented in this file.

## [Unreleased]

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
