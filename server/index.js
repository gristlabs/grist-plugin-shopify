"use strict";

const os = require('os');
const path = require('path');
const _ = require('lodash');

require('dotenv').config({ path: path.resolve(os.homedir(), '.shopify') });
const shopify = require('./shopify');
// todo shema should be defined here and shopify module should declare how to map from shopify
const schema = shopify.schema;

const grist = require('grist-plugin-api');

const storageApi = grist.rpc.getStub('DocStorage@grist');
const docApi = grist.rpc.getStub('GristDocAPI@grist');

grist.rpc.registerFunc('updateTable', updateTable);

// returns an array of user actions that create the table
function createTable(tableId) {
  const columns = schema.map(prop => ({id: prop.colId, type: prop.gristType}));
  const actions = [
    ['AddTable', tableId, columns]
  ];
  return docApi.applyUserActions(actions);
}

// fetch table tableId. If does not exists, creates one based on shopify.schema and fetch it.
function fetchTable(tableId) {
  console.log("fetching tables");
  return docApi.listTables()
    .then(tables => (console.log("listTables: ", tables), tables))
    .then(tables => tables.includes(tableId) ? true : createTable(tableId))
    .then(() => docApi.fetchTable(tableId))
    .then(data => ({
      table: fromTable(data),
      lastRowId: lastRowId(data)
    }));
}

function createLineItemFromTable(data, index) {
  const props = schema.map(prop => [prop.colId, data[prop.colId][index]]);
  props.push(['id', data.id[index]]);
  return _.fromPairs(props);
}

function lastRowId(data) {
  if (data.id.length) {
    return Math.max(...data.id);
  }
  return 0;
}

// returns [{shopifyId: 1, price: 20.1, ...}, {...}, ...]
function fromTable(data) {
  const values = [];
  const count = data.id.length;
  let i = 0;
  for (i; i < count; ++i) {
    values.push(createLineItemFromTable(data, i));
  }
  return values;
}

/**
 * @param{LineItem[]} lines
 */
function updateLineItems(lineItems) {
  if (lineItems.length) {
    const rowIds = lineItems.map(line => line.id);
    const columnValues = _.fromPairs(schema.map(prop => [prop.colId, lineItems.map(li => li[prop.colId])]));
    return docApi.applyUserActions([['BulkUpdateRecord', 'LineItems', rowIds, columnValues]]);
  }
  return Promise.resolve();
}

function addLineItems(lastRowId, lineItems) {
  if (lineItems.length) {
    console.log('adding line items: lastRowid', lastRowId);
    const rowIds = _.range(lastRowId + 1, lastRowId + 1 + lineItems.length);
    const columnValues = _.fromPairs(schema.map(prop => [prop.colId, lineItems.map(li => li[prop.colId])]));
    return docApi.applyUserActions([['BulkAddRecord', 'LineItems', rowIds, columnValues]]);
  }
  return Promise.resolve();
}

function fetchLineItemsFromShopify(opts) {
  return Promise.all([
      storageApi.getItem('shopify-credentials'),
      storageApi.getItem('shopify-apiSecret')
    ])
    .then(([credential, apiSecret]) => Object.assign(credential, {apiSecret}))
    .then(credentials => shopify.fetchLineItems(credentials, opts));
}

function isLineEqual(a, b) {
  if (schema.find(prop => a[prop.colId] !== b[prop.colId]) !== undefined) {
    console.log('islineequal: ', a, b);
    console.log(schema.find(prop => a[prop.colId] !== b[prop.colId]));
  }
  return schema.find(prop => a[prop.colId] !== b[prop.colId]) === undefined;
}

/**
 *
 */
function diff(remoteLines, localLines, idKey) {
  const remoteIndex = _.keyBy(remoteLines, idKey);
  const localIndex = _.keyBy(localLines, idKey);
  const inter = _.intersection(Object.keys(remoteIndex), Object.keys(localIndex));
  const update = inter
    .map(id => isLineEqual(remoteIndex[id], localIndex[id]) ? undefined : Object.assign(localIndex[id], remoteIndex[id]))
    .filter(line => line);
  return {
    adds: _.differenceBy(remoteLines, localLines, idKey),
    update
  };
}

// update table 'LineItems', if table does not exist, creates it.
function updateTable(opts) {
  return Promise.all([
      fetchTable('LineItems'),
      fetchLineItemsFromShopify(opts)
    ])
    .then(([table, shopifyLineItems]) => Object.assign(table, diff(shopifyLineItems, table.table, 'shopifyId')))
    .then(table => Promise.all([
      addLineItems(table.lastRowId, table.adds),
      updateLineItems(table.update)])
        .then(() => ({added: table.adds.length, updated: table.update.length})));
}
exports.updateTable = updateTable;

grist.ready();
