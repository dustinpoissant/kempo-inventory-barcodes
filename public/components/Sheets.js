import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import Dialog from '/kempo-ui/components/Dialog.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Spinner.js';
import { listSheets, createSheet, deleteSheet, sheetUrl, printUrl } from '/inventory-barcodes/sdk.js';

/*
  A person's print sheets, with a button to make a new one. With the `all` attribute it lists everyone's
  instead (the administrator's view) and names who owns each.
*/
export default class Sheets extends ShadowComponent {
  static properties = {
    all: { type: Boolean },
    sheets: { state: true },
    error: { state: true },
    signedOut: { state: true },
    busy: { state: true },
  };

  constructor(){
    super();
    this.all = false;
    this.sheets = null;
    this.error = '';
    this.signedOut = false;
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
    Actions
  */
  load = async () => {
    const [error, data] = await listSheets({ all: this.all });
    if(error){
      this.signedOut = error.code === 401;
      this.error = this.signedOut ? '' : error.msg;
      this.sheets = [];
      return;
    }
    this.sheets = data.sheets;
  };

  create = async () => {
    this.busy = true;
    const [error, data] = await createSheet();
    if(error){
      this.busy = false;
      Toast.error(error.msg);
      return;
    }
    location.assign(sheetUrl(data.sheet.id));
  };

  remove = sheet => Dialog.confirm(
    `Delete "${sheet.name}"? Its ${sheet.lines} ${sheet.lines === 1 ? 'line is' : 'lines are'} removed from the sheet. Nothing in the inventory changes.`,
    async confirmed => {
      if(!confirmed) return;
      const [error] = await deleteSheet(sheet.id);
      if(error){
        Toast.error(error.msg);
        return;
      }
      Toast.success('Sheet deleted');
      this.sheets = this.sheets.filter(own => own.id !== sheet.id);
    },
    { title: 'Delete sheet', confirmText: 'Delete', confirmClasses: 'danger ml', cancelText: 'Keep it', cancelClasses: '' },
  );

  /*
    View
  */
  renderSheet(sheet){
    return html`<div class="b r p mb d-f" style="align-items: center;">
      <div class="flex mr">
        <strong>${sheet.name}</strong>
        <small class="d-b tc-muted">${this.all && sheet.owner ? html`${sheet.owner} · ` : ''}${sheet.labels} ${sheet.labels === 1 ? 'label' : 'labels'} · ${sheet.lines} ${sheet.lines === 1 ? 'line' : 'lines'} · changed ${new Date(sheet.updated).toLocaleString()}</small>
      </div>
      <a class="btn mr" href=${sheetUrl(sheet.id)}>Open</a>
      <a class="btn mr" href=${printUrl(sheet.id)} target="_blank"><k-icon src="/inventory-barcodes/icons/print.svg"></k-icon> Print</a>
      <button class="danger m0" aria-label=${`Delete ${sheet.name}`} @click=${() => this.remove(sheet)}><k-icon name="delete"></k-icon></button>
    </div>`;
  }

  render(){
    if(this.sheets === null) return html`<k-spinner></k-spinner>`;
    if(this.signedOut) return html`<p>Sign in to see your print sheets.</p><a class="btn primary" href="/login/">Sign in</a>`;
    if(this.error) return html`<p class="tc-danger">${this.error}</p>`;
    return html`
      ${this.all ? '' : html`<button class="primary mb" ?disabled=${this.busy} @click=${this.create}><k-icon name="add"></k-icon> New sheet</button>`}
      ${this.sheets.length
        ? this.sheets.map(sheet => this.renderSheet(sheet))
        : html`<p class="tc-muted">${this.all ? 'Nobody has made a print sheet yet.' : 'You have no print sheets yet. Make one, then add the items you need labels for.'}</p>`}
    `;
  }
}

customElements.define('k-inventory-barcodes-sheets', Sheets);
