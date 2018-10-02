"use strict";

/* globals grist, document, window */

const $el = document.getElementById.bind(document);
const credentialsItems = ['storeName', 'apiKey'];

// todo: test pressing ENTER on credentials input: should not trigger page reload.
class Shopify {

  constructor() {
    grist.ready();
    this.storageApi = grist.rpc.getStub('DocStorage@grist');

    // init
    this.storageApi.getItem('shopify-credentials').then(credentials => this.setCredentials(credentials));
//    credentialsItems.forEach(item => $el(item).addEventListener('change', () => this.saveCredentials()));
//    $el('apiSecret').addEventListener('change', () => this.saveSecret());
    $el('saveCredentials').addEventListener('click', () => this.saveCredentials());
    $el('update').addEventListener('click', () => this.updateTable());
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    $el('startDate').value = startDate.toISOString().split('T')[0];
    $el('endDate').value = (new Date()).toISOString().split('T')[0];
  }

  // set credentials from { storeName: "my store name", apiKey: "my api key", apiSecret: "my secret"}
  setCredentials(settings) {
    if (settings) {
      for (const item in settings) {
        const el = $el(item);
        if (el) {
          el.value = settings[item];
        }
      }
    }
  }

  // save credentials to plugins doc storage.
  saveCredentials() {
    const settings = {};
    credentialsItems.forEach(item => {
      settings[item] = $el(item).value;
    });
    console.log('saving credentials to doc storage...');
    return Promise.all([
      this.storageApi.setItem('shopify-credentials', settings),
      this.storageApi.setItem('shopify-apiSecret', $el('apiSecret').value)
    ]);
  }

  // load data from Shopify, format, diff with actual, and merge into table. If needed store some
  // state in the docStorage (timestamp maybe ?).
  updateTable() {
    const startDate = new Date($el('startDate').value);
    const endDate = new Date($el('endDate').value + " 23:59:59.999");   // Use end-of-day
    $el('loader').classList.add('loader');
    grist.rpc.callRemoteFunc('updateTable@dist/server/index.js', {endDate, startDate})
      .then(res => this.showMessage(res))
      .catch(err => this.showError(err))
      .then(() => $el('loader').classList.remove('loader'));
  }

  showError(msg) {
    $el('result').innerHTML = msg;
  }

  showMessage(res) {
    $el('result').innerHTML = `${res.added} new lines were added<br>${res.updated} lines were updated`;
  }
}

window.onload = () => new Shopify();
