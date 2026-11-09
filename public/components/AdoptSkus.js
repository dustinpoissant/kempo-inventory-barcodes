import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import '/kempo-ui/components/Icon.js';
import { adoptSkus, itemUrl } from '/inventory-barcodes/sdk.js';

/*
  For items scanned in before barcodes were kept apart from SKUs: gives each item whose SKU is a real product
  code a barcode of the same text. Safe to run as often as you like.
*/
export default class AdoptSkus extends ShadowComponent {
  static properties = {
    busy: { state: true },
    summary: { state: true },
  };

  constructor(){
    super();
    this.busy = false;
    this.summary = null;
  }

  /*
    Event handlers
  */
  run = async () => {
    this.busy = true;
    const [error, summary] = await adoptSkus();
    this.busy = false;
    if(error){
      Toast.error(error.msg);
      return;
    }
    this.summary = summary;
    Toast.success(summary.added ? `Added ${summary.added} ${summary.added === 1 ? 'barcode' : 'barcodes'}` : 'Nothing new to add');
  };

  /*
    View
  */
  render(){
    const { summary } = this;
    return html`
      <p class="tc-muted">Items scanned in before this extension kept the barcode as their SKU. This gives every item whose SKU is a real product code (a UPC or EAN) a barcode of the same number, so its label prints as the true barcode and a scan matches it with or without a leading zero. SKUs that are not product codes, such as part numbers, are left alone. The SKU itself does not change, and running it again adds nothing twice.</p>
      <button class="primary" ?disabled=${this.busy} @click=${this.run}><k-icon name="add"></k-icon> Add barcodes for SKUs that are product codes</button>
      ${summary ? html`
        <p class="mt">Checked ${summary.checked} ${summary.checked === 1 ? 'item' : 'items'}: ${summary.added} added, ${summary.already} already had one.</p>
        ${summary.conflicts.length ? html`
          <p class="tc-danger mbq">${summary.conflicts.length} could not be added because another item already has the same code. They are probably duplicates. Open one, add the other's code to it, and confirm the merge:</p>
          <ul>${summary.conflicts.map(item => html`<li><a href=${itemUrl(item.id)}>${item.name}</a> <span class="tc-muted">(${item.sku})</span>${item.otherId ? html` has the same code as <a href=${itemUrl(item.otherId)}>${item.otherName || 'another item'}</a>` : ''}</li>`)}</ul>` : ''}` : ''}
    `;
  }
}

customElements.define('k-inventory-barcodes-adopt-skus', AdoptSkus);
