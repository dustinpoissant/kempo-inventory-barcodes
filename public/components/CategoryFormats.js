import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html } from '/kempo-ui/lit-all.min.js';
import Toast from '/kempo-ui/components/Toast.js';
import '/kempo-ui/components/Spinner.js';
import { getFormats, setCategoryFormat, previewFormat } from '/inventory-barcodes/sdk.js';

/*
  The label format of each category, on the Barcodes tab of the inventory admin. A category with no format of its
  own uses the site default (the Settings tab). Each row previews the format on one of the category's items.
*/
export default class CategoryFormats extends ShadowComponent {
  static properties = {
    data: { state: true },
    drafts: { state: true },
    previews: { state: true },
    error: { state: true },
  };

  constructor(){
    super();
    this.data = null;
    this.drafts = {};
    this.previews = {};
    this.error = '';
  }

  /*
    Lifecycle callbacks
  */
  connectedCallback(){
    super.connectedCallback();
    this.load();
  }

  /*
    Loading and saving
  */
  load = async () => {
    const [error, data] = await getFormats();
    if(error){
      this.error = error.msg;
      return;
    }
    this.data = data;
    this.drafts = Object.fromEntries(data.categories.map(category => [category.key, category.format]));
    this.previews = {};
    await Promise.all(data.categories.map(category => this.preview(category, category.format)));
  };

  preview = async (category, format) => {
    const [error, result] = await previewFormat(format, category.sample.id);
    this.previews = { ...this.previews, [category.key]: error ? { error: error.msg } : result.text };
  };

  save = async category => {
    const format = (this.drafts[category.key] ?? '').trim();
    const [error] = await setCategoryFormat(category.key, format);
    if(error){
      Toast.error(error.msg);
      return;
    }
    Toast.success(format ? `${category.name} now uses its own format` : `${category.name} uses the site default`);
    await this.load();
  };

  /*
    View
  */
  renderRow(category){
    if(!category.key) return html`<tr><td><strong>Uncategorised</strong><br><small class="tc-muted">${category.count} ${category.count === 1 ? 'item' : 'items'}</small></td><td colspan="2"><small class="tc-muted">Items with no category use the site default. Put them in a category to give them their own format.</small></td></tr>`;
    const draft = this.drafts[category.key] ?? '';
    const changed = draft.trim() !== category.format;
    const preview = this.previews[category.key];
    return html`<tr>
      <td><strong>${category.name}</strong><br><small class="tc-muted">${category.count} ${category.count === 1 ? 'item' : 'items'}</small></td>
      <td>
        <input type="text" class="full m0" maxlength="200" aria-label=${`Label format for ${category.name}`} placeholder=${this.data.site}
          .value=${draft} @input=${event => { this.drafts = { ...this.drafts, [category.key]: event.target.value }; }}>
        <small class="d-b tc-muted">Preview of ${category.sample.name}: ${preview ?? ''}</small>
      </td>
      <td><button class="primary m0" ?disabled=${!changed} @click=${() => this.save(category)}>Save</button></td>
    </tr>`;
  }

  render(){
    if(this.error) return html`<p class="tc-danger">${this.error}</p>`;
    if(!this.data) return html`<k-spinner></k-spinner>`;
    return html`
      <p class="tc-muted mb">The text printed above each barcode. A category with no format of its own uses the site default: <code>${this.data.site}</code> (change it on the Settings tab). A format can use <code>{attribute:brand}</code>, <code>{attribute:finish|"text"}</code> and <code>{name}</code>, and an item can have its own format on its Barcodes tab.</p>
      ${this.data.categories.length
        ? html`<table>
            <thead><tr><th>Category</th><th>Format</th><th></th></tr></thead>
            <tbody>${this.data.categories.map(category => this.renderRow(category))}</tbody>
          </table>`
        : html`<p class="tc-muted">No items yet. A category appears here once an item is in it.</p>`}
    `;
  }
}

customElements.define('k-inventory-barcodes-category-formats', CategoryFormats);
