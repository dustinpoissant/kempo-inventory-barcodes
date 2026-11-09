# kempo-inventory-barcodes

Barcodes for [kempo-inventory](https://github.com/dustinpoissant/kempo-inventory), a [kempo](https://www.npmjs.com/package/kempo) CMS extension. It does three things:

- **Several codes per item, one of them primary.** A bin can carry the real UPC, a code made up for it, or both, and a scan of any of them opens the same item.
- **Temporary codes you can later merge with the real one.** An item with no barcode gets a made-up code (`INV-000123`) to label it today. When a box with the real barcode turns up, add that code to the same item and make it the primary. Every label already on a bin keeps working.
- **Print sheets.** Collect the labels you need (3 of this one, 5 of that one), then print one page of labels to cut out and tape on. A sheet lives on the server and belongs to an account, so it can be built on a phone and printed from the computer with the printer.

## Install

```bash
npm install kempo-inventory-barcodes
```

Then **Admin > Extensions > Install**. It needs `kempo-inventory` to be installed and enabled first (it declares it as a dependency). Peers: `kempo` >= 4.11.0, `kempo-inventory` >= 0.5.0, `kempo-ui` >= 1.0.0.

## How the codes work

A code belongs to **one item**, and an item has **any number** of codes. Exactly one is the item's **primary**: the one a print sheet uses unless told otherwise.

| Kind | Meaning |
|---|---|
| Product code | A UPC-A, UPC-E, EAN-8, EAN-13 or GTIN-14 whose check digit is right. Printed as itself (a UPC-A, UPC-E, EAN-8 or EAN-13 symbol; a GTIN-14 as Code 128): a UPC prints as a UPC |
| Made up for this item | The code this extension makes for an item that has none: `PREFIX-000123`, numbered from one counter so two people asking at once never get the same number. An item has at most one. Printed as Code 128 |
| Other code | Anything else that was scanned or typed (a QR text, a serial). Printed as Code 128 |

- **One code can never open two items.** All-digit codes are compared without leading zeros, because the same product comes back as 12 digits (UPC-A) from one decoder and 13 (EAN-13) from another.
- A product code whose last digit does not match is almost always a misread. It is refused unless you confirm.
- **The SKU still works.** Items scanned in before this extension kept the barcode as their SKU, and a lookup falls back to the SKU. **Admin > Barcodes > Existing barcodes** gives every item whose SKU is a real product code a barcode of the same number, so it prints as the true barcode. SKUs that are not product codes (part numbers) are left alone, and the SKU itself never changes.
- The primary code cannot be removed until another takes over, so an item that has codes always has a primary. Deleting an item deletes its codes and its lines on every sheet.

### Adding the real barcode, and merging

On an item's page (**Barcodes** section), type or scan a code and **Add barcode**; **Make primary** switches the primary. If the code already belongs to another item, which usually means you made two items for one thing, you are offered a **merge**: everything of the other item moves to this one and the other item is deleted.

A merge moves the other item's barcodes (the primary of the item that stays remains primary), its SKU as one more barcode, its lines on every print sheet and its quantity (recorded as a movement on both items), then deletes it. The codes and sheet lines move together or not at all. The quantity and the delete are kempo-inventory's own work and can be refused (an item that products are made from cannot be deleted): the result then carries a warning, and the duplicate is left empty and without codes for you to delete. Merging needs `items:update` and `items:delete`, and cannot be undone.

## Print sheets

Everyone who may read the inventory can make print sheets. A sheet is one person's: nobody else can see, change or print it (they get a 404), except an administrator with `kempo-inventory-barcodes:manage`. Deleting an account deletes its sheets.

- **`/inventory-barcodes/`** lists your sheets and makes a new one.
- **`/inventory-barcodes/sheet?id=…`** edits one. Search for an item or **Scan to add**, choose how many copies, **Add to sheet**. Each line has its copies, whether the item's **name** is printed above the barcode, and (when the item has several codes) which code to print. A sheet has one line per code, so adding an item that is already on it adds to its line, even when two devices add at once.
- **`/inventory-barcodes/print/<sheet id>`** is the page of labels, as many per sheet of paper as fit. Lines run on from one another with no part-filled pages between them, and a sheet with more labels than a page holds continues on the next page.
- **`/inventory-barcodes/item?id=…`** is an item's codes, with **Add to print sheet** for that item.

An item with no code is given one the first time it goes on a sheet: its SKU when that is a real product code, otherwise a made-up one.

**Printing.** In the print dialog choose scale **100% (Actual size)**, not Fit to page, or the labels will not match their size. Labels were checked by reading a rendering of each at its printed size with the same ZXing decoder the scanner uses. Let ink dry before taping, and tape clear tape over the whole label.

The print page is the one place this extension writes CSS: the paper and label sizes are settings, so they cannot be utility classes. It is a standalone page that needs nothing from the site.

## Settings

Label text is built from a format. Placeholders:

- `{attribute:Label}`: one of the item's attributes, named by its field's label in lower case with spaces as dashes. `{attribute:brand}`, `{attribute:finish}`, `{attribute:manufacturer-code}`. A clear coat's "Brand" is `{attribute:brand}` too, whatever its field key.
- `{name}`, `{sku}`, `{category}`: the item's own.

An attribute the item does not have leaves its placeholder out together with the dash beside it, so one format serves every item: "Apple Barrel - Matte - Admiral Blue", or "Admiral Blue" when there is no brand. Photos and colours are never printed.

A format of just `{name}` gives the item's name as before. The format is also shown on each line of a print sheet.

**Admin > Barcodes > Settings** (sizes are inches). The defaults print 30 labels of 2.5" x 1" on US Letter, 3 across and 10 down.

| Setting | Default | |
|---|---|---|
| `sheet_width`, `sheet_height` | 8.5, 11 | The paper |
| `sheet_margin` | 0.5 | Blank space around the edge |
| `label_width`, `label_height` | 2.5, 1 | One label |
| `label_gap` | 0 | Space between labels. Leave at 0 to cut along shared lines |
| `label_text` | on | Whether new sheet lines print text above the barcode. Each line can still turn it on or off |
| `label_format` | `{attribute:brand} - {attribute:finish} - {name}` | The text above the barcode, built from the item (see below) |
| `label_text_size` | 9 | Size of the name, in points |
| `label_cut_guides` | on | A thin outline around each label |
| `internal_prefix` | `INV` | Start of made-up codes. Capital letters and numbers |

A bad value falls back to its default, so a mistyped setting cannot break printing. If a label is bigger than the printable part of the paper, the sheet says so instead of printing.

## Permissions and groups

Nothing new is needed to use sheets: they follow the inventory's own rules.

| Action | Needs |
|---|---|
| See an item's codes, look a scan up | `kempo-inventory:items:read`, or the inventory's `public_read` setting (then signed-out visitors too; they never see stock counts) |
| Make, edit, print your own sheets | Signed in, and the same read rule |
| Add a code, make a code up, change the primary, remove a code | `kempo-inventory:items:update` |
| Merge two items | `kempo-inventory:items:update` and `kempo-inventory:items:delete` |
| Change the settings, see and delete everyone's sheets, adopt SKUs | `kempo-inventory-barcodes:manage` (group `kempo-inventory-barcodes:admin`, which holds nothing else: give it alongside an inventory group) |

## Using it on a site's scan page

`/inventory-barcodes/api/lookup?code=` answers with the item a scan opens, whichever of its codes it was. A site's own scanner should call it instead of comparing the scan with SKUs, or a bin labelled with a code other than the SKU will say "not in the inventory":

```js
const response = await fetch(`/inventory-barcodes/api/lookup?code=${encodeURIComponent(code)}`);
if(response.ok){
  const { item, barcode, codes } = await response.json();   // 404: not in the inventory
}
```

Item pages can show an item's codes with `<k-inventory-barcodes-item-codes item-id="…"></k-inventory-barcodes-item-codes>` (load `/inventory-barcodes/components/ItemCodes.js`), or link to `/inventory-barcodes/item?id=…`. The admin item page shows the same section automatically, through kempo-inventory's `inventory-item-sections` location. **Barcode sheets** is also offered as a menu item (**Admin > Content > Menus**).

## API

Routes are under `/inventory-barcodes/api`. All answer JSON. Errors are `{ error }`; a refused code also carries `conflictItemId` (another item has it) or `mistyped` (its last digit is wrong).

| Route | Purpose |
|---|---|
| `GET /config` | The label and paper sizes and how many labels one page holds |
| `GET /lookup?code=` | The item a scanned code opens: `{ item, barcode, via, codes }` (`via` is `barcode` or `sku`) |
| `GET /items/[id]/barcodes` | An item's codes, primary first |
| `POST /items/[id]/barcodes` | `{ code, makePrimary?, force? }` adds a code, `{ generate: true }` makes one up. 409 when another item has the code |
| `PATCH /barcodes/[id]` | `{ primary: true }` |
| `DELETE /barcodes/[id]` | Remove a code (not the primary) |
| `POST /merge` | `{ fromId, intoId }` |
| `POST /import-skus` | Adopt SKUs that are product codes (manage) |
| `GET /sheets` · `POST /sheets` | Your sheets (`?all=true` for everyone's, manage) · make one `{ name? }` |
| `GET` · `PATCH` · `DELETE /sheets/[id]` | One sheet with its lines and `summary` (`labels`, `pages`, `perPage`, `columns`, `rows`) · rename `{ name }` · delete |
| `POST /sheets/[id]/entries` | `{ itemId, quantity?, barcodeId?, showText? }` |
| `PATCH` · `DELETE /sheets/[id]/entries/[entryId]` | `{ quantity?, showText?, barcodeId? }` · remove |

The calls that change a sheet answer with the sheet as it now stands. The browser SDK is `/inventory-barcodes/sdk.js`.

### Server SDK

```js
import { findByCode, ensurePrimary, addCode, makeInternalCode, mergeItems } from 'kempo-inventory-barcodes/sdk';

const [error, found] = await findByCode(scannedText);   // { item, barcode, via }
```

Every function resolves to `[error, result]`. Also exported: `getCodes`, `getCodesForItems`, `setPrimary`, `removeCode`, `adoptSkus`, and the pure helpers `cleanCode`, `lookupKey`, `isGtin`, `kindOf`, `symbologyFor` and `barcodeSvg`.

## Notes for maintainers

- Barcodes are drawn with [bwip-js](https://github.com/metafloor/bwip-js) on the server (SVG, text drawn as shapes, so no font is needed).
- Kempo builds a fresh install's tables from their columns only, so `install.js` creates the indexes declared in `server/db/schema.js` with the same names (a test keeps the two in step). An update adds any that are missing.
- Server code is cached by a running server: after changing `server/`, restart it. Pages and components are read fresh.
- `npm run link:local` links the sibling repos for development; `npm test` runs the suite on an in-memory Postgres (PGlite).
