import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import '/kempo-ui/components/Combobox.js';
import '/kempo-ui/components/Toggle.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Spinner.js';
import { getItems } from '/inventory/sdk.js';
import { scanBarcode } from '/inventory/components/BarcodeScanner.js';
import { getSheet, renameSheet, addEntry, updateEntry, removeEntry, lookup, printUrl } from '/inventory-barcodes/sdk.js';

/*
  One print sheet, built up line by line: find an item (type its name or scan it), say how many copies of its
  label, and add it. The sheet is kept on the server, so it can be built on a phone and printed from the
  computer with the printer. The sheet to edit is in the address as ?id=.
*/
export default class SheetEditor extends ShadowComponent {
  static properties = {
    sheet: { state: true },
    entries: { state: true },
    summary: { state: true },
    error: { state: true },
    signedOut: { state: true },
    name: { state: true },
    pick: { state: true },
    quantity: { state: true },
    saving: { state: true },
  };

  constructor(){
    super();
    this.sheet = null;
    this.entries = [];
    this.summary = null;
    this.error = '';
    this.signedOut = false;
    this.name = '';
    this.pick = null;
    this.quantity = '1';
    this.saving = new Set();
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
  get sheetId(){
    return new URLSearchParams(location.search).get('id');
  }

  apply = data => {
    this.sheet = data.sheet;
    this.entries = data.entries;
    this.summary = data.summary;
    this.name = data.sheet.name;
  };

  load = async () => {
    const [error, data] = await getSheet(this.sheetId);
    if(error){
      this.signedOut = error.code === 401;
      this.error = this.signedOut ? '' : error.code === 404 ? 'This sheet was not found. It may have been deleted, or it belongs to someone else.' : error.msg;
      return;
    }
    this.apply(data);
  };

  /* Runs a change to one line with that line disabled, and puts the sheet back as the server has it if the change fails. */
  change = async (entry, send) => {
    this.saving = new Set([...this.saving, entry.id]);
    const [error, data] = await send();
    this.saving = new Set([...this.saving].filter(id => id !== entry.id));
    if(error){
      Toast.error(error.msg);
      await this.load();
      return;
    }
    this.apply(data);
  };

  /*
    Event handlers
  */
  rename = async () => {
    const [error] = await renameSheet(this.sheet.id, this.name);
    if(error){
      Toast.error(error.msg);
      return;
    }
    this.sheet = { ...this.sheet, name: this.name.trim() };
    Toast.success('Sheet renamed');
  };

  search = async event => {
    const $combobox = event.currentTarget;
    const [error, data] = await getItems({ q: event.detail.value, limit: 10 });
    if(error) return;
    $combobox.setOptions(data.items.map(item => ({ label: `${item.name} (${item.sku})`, value: item.id })));
  };

  choose = event => {
    this.pick = { itemId: event.detail.value, label: event.detail.label };
  };

  add = async (itemId, label) => {
    const [error, data] = await addEntry(this.sheet.id, { itemId, quantity: Number(this.quantity) || 1 });
    if(error){
      Toast.error(error.msg);
      return;
    }
    this.apply(data);
    this.pick = null;
    Toast.success(`Added ${label}`);
  };

  addPicked = () => this.add(this.pick.itemId, this.pick.label);

  scan = async () => {
    const code = await scanBarcode();
    if(!code) return;
    const [error, found] = await lookup(code);
    if(error){
      Toast.error(error.code === 404 ? `${code} is not in the inventory yet. Add the item first, then scan again.` : error.msg);
      return;
    }
    await this.add(found.item.id, found.item.name);
  };

  /*
    View
  */
  renderEntry(entry){
    const busy = this.saving.has(entry.id);
    return html`<div class="b r p mb d-f" style="align-items: center;">
      <div class="flex mr">
        <strong>${entry.itemName}</strong>
        <small class="d-b tc-muted">${entry.sku}</small>
        ${entry.missing
          ? html`<small class="d-b tc-danger">The item or code was deleted. This line is left out of the print.</small>`
          : entry.codes.length > 1
            ? html`<select class="mt0 mb0" aria-label="Code to print" ?disabled=${busy} @change=${event => this.change(entry, () => updateEntry(this.sheet.id, entry.id, { barcodeId: event.target.value }))}>
                ${entry.codes.map(code => html`<option value=${code.id} ?selected=${code.id === entry.barcodeId}>${code.code}${code.isPrimary ? ' (primary)' : ''}</option>`)}
              </select>`
            : entry.code === entry.sku ? '' : html`<small class="d-b tc-muted">${entry.code}</small>`}
      </div>
      <label class="mr">Copies
        <input type="number" min="1" max="500" step="1" class="m0" style="width: 6rem;" .value=${String(entry.quantity)} ?disabled=${busy}
          @change=${event => this.change(entry, () => updateEntry(this.sheet.id, entry.id, { quantity: Number(event.target.value) || 1 }))}>
      </label>
      <label class="mr">Show name
        <k-toggle .value=${entry.showText} ?disabled=${busy}
          @change=${event => event.detail.value !== entry.showText && this.change(entry, () => updateEntry(this.sheet.id, entry.id, { showText: event.detail.value }))}></k-toggle>
      </label>
      <button class="danger m0" aria-label=${`Remove ${entry.itemName}`} ?disabled=${busy} @click=${() => this.change(entry, () => removeEntry(this.sheet.id, entry.id))}><k-icon name="delete"></k-icon></button>
    </div>`;
  }

  render(){
    if(this.signedOut) return html`<p>Sign in to edit your print sheets.</p><a class="btn primary" href="/login/">Sign in</a>`;
    if(this.error) return html`<p class="tc-danger">${this.error}</p><a class="btn" href="/inventory-barcodes/">Your print sheets</a>`;
    if(!this.sheet) return html`<k-spinner></k-spinner>`;
    const { summary } = this;
    const printable = summary && !summary.error && summary.labels > 0;
    return html`
      <div class="d-f mb" style="align-items: flex-end;">
        <label class="flex mr">Sheet name
          <input type="text" class="m0 full" maxlength="100" .value=${this.name} @input=${event => { this.name = event.target.value; }} @keydown=${event => event.key === 'Enter' && this.rename()}>
        </label>
        <button class="m0" ?disabled=${!this.name.trim() || this.name.trim() === this.sheet.name} @click=${this.rename}>Save name</button>
      </div>

      <div class="b r p mb">
        <h4>Add an item</h4>
        <div class="d-f" style="align-items: flex-end;">
          <div class="flex mr" style="min-width: 14rem;">
            <k-combobox class="full" placeholder="Search by name or SKU…" aria-label="Item" .value=${this.pick?.label ?? ''}
              empty-message="Type to search the inventory" no-results-message="Nothing found"
              @search=${this.search} @select=${this.choose}></k-combobox>
          </div>
          <label class="mr">Copies
            <input type="number" min="1" max="500" step="1" class="m0" style="width: 6rem;" .value=${this.quantity} @input=${event => { this.quantity = event.target.value; }}>
          </label>
          <button class="primary m0 mr" ?disabled=${!this.pick} @click=${this.addPicked}><k-icon name="add"></k-icon> Add to sheet</button>
          <button class="m0" @click=${this.scan}><k-icon src="/inventory-barcodes/icons/barcode_scanner.svg"></k-icon> Scan to add</button>
        </div>
      </div>

      ${this.entries.length
        ? this.entries.map(entry => this.renderEntry(entry))
        : html`<p class="tc-muted">Nothing on this sheet yet. Add an item above and choose how many copies of its label to print.</p>`}

      <div class="d-f mt" style="align-items: center;">
        <p class="flex mr mb0 ${summary?.error ? 'tc-danger' : ''}">${summary?.error
          ? summary.error
          : `${summary.labels} ${summary.labels === 1 ? 'label' : 'labels'} on ${summary.pages} ${summary.pages === 1 ? 'page' : 'pages'} (${summary.columns} across, ${summary.rows} down, ${summary.perPage} to a page)`}</p>
        ${printable
          ? html`<a class="btn primary m0 mr" href=${printUrl(this.sheet.id)} target="_blank"><k-icon src="/inventory-barcodes/icons/print.svg"></k-icon> Print</a>`
          : html`<button class="primary m0 mr" disabled><k-icon src="/inventory-barcodes/icons/print.svg"></k-icon> Print</button>`}
        <a class="btn m0" href="/inventory-barcodes/">All sheets</a>
      </div>
    `;
  }
}

customElements.define('k-inventory-barcodes-sheet', SheetEditor);
