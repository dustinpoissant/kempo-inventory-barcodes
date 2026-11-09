import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import Dialog from '/kempo-ui/components/Dialog.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Spinner.js';
import { getItem } from '/inventory/sdk.js';
import { getAllCurrentUserPermissions } from '/kempo/sdk.js';
import { scanBarcode } from '/inventory/components/BarcodeScanner.js';
import { setItemFormat, previewFormat } from '/inventory-barcodes/sdk.js';
import { getCodes, addCode, generateCode, setPrimary, removeCode, mergeItems, listSheets, createSheet, addEntry, sheetUrl } from '/inventory-barcodes/sdk.js';

const KINDS = { upc: 'Product code', internal: 'Made up for this item', other: 'Other code' };

const REMEMBER = 'inventory-barcodes:last-sheet';

/* The browser may refuse storage (private windows); remembering the last sheet is only a convenience. */
const remembered = () => {
  try {
    return localStorage.getItem(REMEMBER) || '';
  } catch {
    return '';
  }
};

const remember = id => {
  try {
    localStorage.setItem(REMEMBER, id);
  } catch {
    /* nothing to do: the choice is simply not remembered */
  }
};

/*
  An item's barcodes: every code that opens it with one marked primary, a way to add the real code once you
  have it (or make one up for an item that has none), and a way to put its label on a print sheet. The item is
  the `item-id` attribute, or ?id= in the address. Merging in a real code that another item already holds
  offers to merge the two items.
*/
export default class ItemCodes extends ShadowComponent {
  static properties = {
    itemId: { type: String, attribute: 'item-id' },
    showName: { type: Boolean, attribute: 'show-name' },
    item: { state: true },
    codes: { state: true },
    label: { state: true },
    formatDraft: { state: true },
    preview: { state: true },
    permissions: { state: true },
    sheets: { state: true },
    error: { state: true },
    newCode: { state: true },
    sheetChoice: { state: true },
    copies: { state: true },
    busy: { state: true },
  };

  constructor(){
    super();
    this.itemId = '';
    this.showName = false;
    this.item = null;
    this.codes = [];
    this.permissions = new Set();
    this.sheets = null;
    this.error = '';
    this.newCode = '';
    this.sheetChoice = '';
    this.copies = '1';
    this.busy = false;
  }

  /*
    Lifecycle callbacks
  */
  connectedCallback(){
    super.connectedCallback();
    this.load();
  }

  /*
    Loading
  */
  get id(){
    return this.itemId || new URLSearchParams(location.search).get('id');
  }

  load = async () => {
    const [[itemError, itemData], [codesError, codesData], [, permissionData], [, sheetData]] = await Promise.all([getItem(this.id), getCodes(this.id), getAllCurrentUserPermissions(), listSheets()]);
    if(itemError || codesError){
      this.error = (itemError || codesError).code === 404 ? 'Item not found.' : (itemError || codesError).msg;
      return;
    }
    this.item = itemData.item;
    this.codes = codesData.codes;
    this.label = codesData.label;
    this.formatDraft = this.label?.source === 'item' ? this.label.format : '';
    this.permissions = new Set(permissionData?.permissions ?? []);
    this.sheets = sheetData?.sheets ?? null;
    const last = remembered();
    this.sheetChoice = this.sheets?.some(sheet => sheet.id === last) ? last : this.sheets?.[0]?.id ?? 'new';
  };

  loadCodes = async () => {
    const [error, data] = await getCodes(this.item.id);
    if(error) Toast.error(error.msg);
    else {
      this.codes = data.codes;
      this.label = data.label;
      this.formatDraft = this.label?.source === 'item' ? this.label.format : '';
    }
  };

  get canEdit(){
    return this.permissions.has('kempo-inventory:items:update');
  }

  get canMerge(){
    return this.canEdit && this.permissions.has('kempo-inventory:items:delete');
  }

  /*
    Changing the codes
  */
  addNew = async (raw, force = false) => {
    this.busy = true;
    const [error, data] = await addCode(this.item.id, { code: raw, force });
    this.busy = false;
    if(error){
      if(error.mistyped) this.askUseAnyway(raw);
      else if(error.conflictItemId) await this.offerMerge(raw, error.conflictItemId);
      else Toast.error(error.msg);
      return;
    }
    this.newCode = '';
    Toast.success(data.existing ? 'This item already has that code' : 'Barcode added');
    await this.loadCodes();
  };

  askUseAnyway = raw => Dialog.confirm(
    `${raw} looks like a product code, but its last digit does not match, which usually means it was typed or scanned wrongly. Use it anyway?`,
    confirmed => confirmed && this.addNew(raw, true),
    { title: 'Check the code', confirmText: 'Use it anyway', confirmClasses: 'danger ml', cancelText: 'Retype it', cancelClasses: '' },
  );

  offerMerge = async (raw, otherId) => {
    const [error, data] = await getItem(otherId);
    const other = error ? null : data.item;
    const name = other ? `${other.name}${other.sku ? ` (${other.sku})` : ''}` : 'another item';
    if(!this.canMerge){
      Toast.error(`${raw} already belongs to ${name}. Ask someone who can delete items to merge them.`);
      return;
    }
    Dialog.confirm(
      html`<div class="p">
        <p>The code <strong>${raw}</strong> already belongs to <strong>${name}</strong>.</p>
        <p>If they are the same thing, merge it into <strong>${this.item.name}</strong>: its barcodes, SKU, print sheet lines${other?.quantity !== undefined ? html` and quantity (${other.quantity})` : ''} move here, and then it is deleted. This cannot be undone.</p>
      </div>`,
      async confirmed => {
        if(!confirmed) return;
        const [mergeError, result] = await mergeItems(otherId, this.item.id);
        if(mergeError){
          Toast.error(mergeError.msg);
          return;
        }
        if(result.warning) Toast.error(result.warning);
        else Toast.success('Items merged');
        await this.loadCodes();
      },
      { title: 'Merge items?', confirmText: 'Merge into this item', confirmClasses: 'danger ml', cancelText: 'Cancel', cancelClasses: '' },
    );
  };

  scan = async () => {
    const code = await scanBarcode();
    if(code) await this.addNew(code);
  };

  generate = async () => {
    this.busy = true;
    const [error, data] = await generateCode(this.item.id);
    this.busy = false;
    if(error){
      Toast.error(error.msg);
      return;
    }
    Toast.success(`Made ${data.barcode.code}`);
    await this.loadCodes();
  };

  makePrimary = async code => {
    const [error] = await setPrimary(code.id);
    if(error){
      Toast.error(error.msg);
      return;
    }
    Toast.success(`${code.code} is now the primary barcode`);
    await this.loadCodes();
  };

  remove = code => Dialog.confirm(
    `Remove ${code.code}? A bin labelled with it will no longer open this item.`,
    async confirmed => {
      if(!confirmed) return;
      const [error] = await removeCode(code.id);
      if(error){
        Toast.error(error.msg);
        return;
      }
      Toast.success('Barcode removed');
      await this.loadCodes();
    },
    { title: 'Remove barcode', confirmText: 'Remove', confirmClasses: 'danger ml', cancelText: 'Keep it', cancelClasses: '' },
  );

  /*
    Printing
  */
  addToSheet = async () => {
    this.busy = true;
    let sheetId = this.sheetChoice;
    if(sheetId === 'new'){
      const [createError, created] = await createSheet();
      if(createError){
        this.busy = false;
        Toast.error(createError.msg);
        return;
      }
      sheetId = created.sheet.id;
    }
    const quantity = Number(this.copies) || 1;
    const [error, data] = await addEntry(sheetId, { itemId: this.item.id, quantity });
    this.busy = false;
    if(error){
      Toast.error(error.msg);
      return;
    }
    remember(sheetId);
    Toast.success(`Added ${quantity} ${quantity === 1 ? 'label' : 'labels'} to "${data.sheet.name}"`);
    const [, listed] = await listSheets();
    this.sheets = listed?.sheets ?? this.sheets;
    this.sheetChoice = sheetId;
    await this.loadCodes();
  };

  /*
    View
  */
  renderCode(code){
    return html`<div class="b r p mb d-f" style="align-items: center;">
      <div class="flex mr">
        <strong class="ff-mono">${code.code}</strong>
        <small class="d-b tc-muted">${KINDS[code.kind] ?? KINDS.other}${code.isPrimary ? ' · Primary, printed by default' : ''}</small>
      </div>
      ${code.isPrimary ? html`<k-icon name="star_filled" aria-label="Primary"></k-icon>` : this.canEdit ? html`
        <button class="mr" @click=${() => this.makePrimary(code)}><k-icon name="star"></k-icon> Make primary</button>
        <button class="danger m0" aria-label=${`Remove ${code.code}`} @click=${() => this.remove(code)}><k-icon name="delete"></k-icon></button>` : ''}
    </div>`;
  }

  renderPrint(){
    if(this.sheets === null) return html`<p class="tc-muted">Sign in to put this item's label on a print sheet.</p>`;
    return html`
      <h4 class="mt">Print its label</h4>
      <div class="d-f" style="align-items: flex-end;">
        <label class="mr">Sheet
          <select class="m0" .value=${this.sheetChoice} @change=${event => { this.sheetChoice = event.target.value; }}>
            ${this.sheets.map(sheet => html`<option value=${sheet.id} ?selected=${sheet.id === this.sheetChoice}>${sheet.name} (${sheet.labels})</option>`)}
            <option value="new" ?selected=${this.sheetChoice === 'new'}>A new sheet</option>
          </select>
        </label>
        <label class="mr">Copies
          <input type="number" min="1" max="500" step="1" class="m0" style="width: 6rem;" .value=${this.copies} @input=${event => { this.copies = event.target.value; }}>
        </label>
        <button class="primary m0 mr" ?disabled=${this.busy} @click=${this.addToSheet}><k-icon src="/inventory-barcodes/icons/print.svg"></k-icon> Add to print sheet</button>
        ${this.sheetChoice && this.sheetChoice !== 'new' ? html`<a class="btn m0" href=${sheetUrl(this.sheetChoice)}>Open the sheet</a>` : ''}
      </div>`;
  }

  saveFormat = async () => {
    const [error] = await setItemFormat(this.item.id, this.formatDraft.trim());
    if(error){
      Toast.error(error.msg);
      return;
    }
    Toast.success(this.formatDraft.trim() ? 'Label format saved for this item' : "This item uses its category's format again");
    await this.loadCodes();
  };

  showPreview = async () => {
    const [error, data] = await previewFormat(this.formatDraft, this.item.id);
    this.preview = error ? { error: error.msg } : data;
  };

  renderLabel(){
    const label = this.label;
    if(!label) return '';
    const inherited = label.source === 'category' ? 'the category format' : 'the site default';
    const origin = label.source === 'item' ? 'this item format' : inherited;
    const placeholder = label.format;
    return html`<h4>Label</h4>
      <p class="mb"><strong id="labelText">${label.text || '(no text)'}</strong><br><small class="tc-muted">Printed above the barcode, from ${origin}.</small></p>
      ${this.canEdit ? html`
        <label class="d-b mbq" for="itemFormat">Format for this item
          <small class="d-b tc-muted">Placeholders: {name}, {sku}, {category}, {attribute:brand}. Use {attribute:brand|"text"} to fall back to text when it is empty. Leave empty to use ${inherited}.</small>
        </label>
        <div class="d-f mb">
          <input id="itemFormat" type="text" class="flex m0 mr" maxlength="200" placeholder=${placeholder} .value=${this.formatDraft}
            @input=${event => { this.formatDraft = event.target.value; }}>
          <button class="m0 mr" @click=${this.showPreview}>Preview</button>
          <button class="primary m0" @click=${this.saveFormat}>Save format</button>
        </div>
        ${this.preview ? html`<p class="tc-muted">${this.preview.error ? this.preview.error : html`Would print: <strong>${this.preview.text || '(no text)'}</strong>`}</p>` : ''}` : ''}`;
  }

  render(){
    if(this.error) return html`<p class="tc-danger">${this.error}</p>`;
    if(!this.item) return html`<k-spinner></k-spinner>`;
    return html`
      ${this.showName ? html`<h2 class="mb0">${this.item.name}</h2><p class="tc-muted">${this.item.sku}</p>` : ''}
      ${this.renderLabel()}
      <h4>Barcodes</h4>
      ${this.codes.length
        ? this.codes.map(code => this.renderCode(code))
        : html`<p class="tc-muted">This item has no barcodes yet. ${this.canEdit ? 'Add the one from its package, or make one up to label it now.' : ''}</p>`}
      ${this.canEdit ? html`
        <label class="d-b mbq" for="newCode">Add a barcode
          <small class="d-b tc-muted">Scan or type the number from the real package. Codes already on bins keep working, so you can add the real one later and make it the primary.</small>
        </label>
        <div class="d-f mb">
          <div class="flex mr" style="min-width: 12rem;">
            <input id="newCode" type="text" class="full m0" maxlength="100" placeholder="Barcode number" .value=${this.newCode}
              @input=${event => { this.newCode = event.target.value; }} @keydown=${event => event.key === 'Enter' && this.newCode.trim() && this.addNew(this.newCode)}>
          </div>
          <button class="m0 mr" ?disabled=${this.busy} @click=${this.scan}><k-icon src="/inventory-barcodes/icons/barcode_scanner.svg"></k-icon> Scan</button>
          <button class="primary m0" ?disabled=${this.busy || !this.newCode.trim()} @click=${() => this.addNew(this.newCode)}><k-icon name="add"></k-icon> Add barcode</button>
        </div>
        ${this.codes.some(code => code.kind === 'internal' || code.kind === 'upc') ? '' : html`
          <p class="tc-muted mbh">No barcode on the package yet? Make up a temporary one to label it now, and add the real one when you have it.</p>
          <button class="mb" ?disabled=${this.busy} @click=${this.generate}>Make a temporary code</button>`}` : ''}
      ${this.renderPrint()}
    `;
  }
}

customElements.define('k-inventory-barcodes-item-codes', ItemCodes);
