"use strict";

const Shopify = require('shopify-api-node');
const fs = require('fse');
const _ = require('lodash');

function fetchData(credentials, opts) {
  console.warn("fetching data from shopify");
  let shopify = new Shopify({
    shopName: credentials.storeName,
    apiKey: credentials.apiKey,
    password: credentials.apiSecret
  });
  const params = {
    status: 'any',
    updated_at_min: opts.startDate,
    updated_at_max: opts.endDate,
    limit: 250, // 250 is the max
  };
  // first get the count of orders
  return shopify.order.count(params).then(count => {
    // compute number of pages to load
    const pages = _.range(1, Math.floor(count / 250) + 2);
    // load all pages
    console.log(`emitting ${pages.length} calls`);
    return Promise.all(pages.map(limit => shopify.order.list(Object.assign({limit}, params))));
  })
  .then((allOrders) => (console.log(`received ${allOrders.length} calls`), [].concat(...allOrders)));
//  return shopify.order.list(params);
}

/**
 * Try to read data from data.json. If file is not found fetch from shopify.
 */
function loadData(credentials, opts) {
  const filepath = "./data.json";
  return fs.readFile(filepath, 'utf8')
    .then(content => JSON.parse(content))
    .catch(err => {
      return fetchData(credentials, opts)
        .then(data => {
          fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
          return data;
        });
    });
}
exports.loadData = loadData;

// default gristType to 'Text' if omitted
const line_items_properties = createProperties([
  {
    key: 'id',
    colId: 'shopifyId',
    gristType: 'Text',
    value: line_item => '' + line_item.id
  },
  {
    key: 'price',
    gristType: 'Numeric',
    value: line_item => Number(line_item.price)
  },
  'title',
  {key: 'quantity', gristType: 'Int'},
  'sku',
  'variant_title',
  'name',
  {
    key: 'discount',
    gristType: 'Numeric',
    value: line_item => _.sum(line_item.discount_allocations.map(da => Number(da.amount)))
  },
  {
    key: 'ordered_at',
    gristType: 'Date',
    value: (li, order) => formatDate(order.created_at)
  },
  {
    key: 'order_name',
    gristType: 'Text',
    value: (li, order) => order.name
  },
  {
    key: 'updated_at',
    gristType: 'Date',
    value: (li, order) => formatDate(order.updated_at)
  }
]);
exports.schema = line_items_properties;

function formatDate(date) {
  const d = new Date(date);
  return Math.floor(d / 1000);
}

function createProperties(props) {
  return props.map(prop => {
    if (typeof prop === 'string') {
      prop = {
        key: prop,
        gristType: 'Text',
      };
    }
    // by default set colId to key
    prop = Object.assign({colId: prop.key}, prop);
    return prop;
  });
}

function value(prop, order, lineItem) {
  return prop.value ? prop.value(lineItem, order) : lineItem[prop.key];
}

function pick_line_items(orders, prop) {
  const values = [];
  for (const order of orders) {
    if (order.line_items) {
      for (const li of order.line_items) {
        values.push(value(prop, li, order));
      }
    }
  }
  return values;
}

function processDataForImport(orders) {
  return {
    tables: [{
      table_name: "line_items",
      column_metadata: line_items_properties.map(prop => ({
        id: prop.key,
        type: prop.gristType
      })),
      table_data: line_items_properties.map(prop => pick_line_items(orders, prop))
    }]
  };
}

// creates a lineItem record as described by the line_items_properties from based an order and a
// lineItem
function lineItem(order, lineItem) {
  return _.fromPairs(line_items_properties.map(prop => [prop.colId, value(prop, order, lineItem)]));
}

// returns [{shopifyId: 1, price: 20.1, ...}, {...}, ...]
function processDataForDiff(orders) {
  const values = [];
  for (const order of orders) {
    if (order.line_items) {
      for (const li of order.line_items) {
        values.push(lineItem(order, li));
      }
    }
  }
  return values;
}
exports.processDataForDiff = processDataForDiff;

function list(credentials, opt = {}) {
  return fetchData(credentials)
    .then(orders => opt.format === "import" ? processDataForImport(orders) : processDataForDiff(orders));
}
exports.list = list;

function fetchLineItems(credentials, opts) {
  return fetchData(credentials, opts)
      .then(processDataForDiff);
}
exports.fetchLineItems = fetchLineItems;

if (require.main === module) {
  list()
    .then(data => {
      console.log(JSON.stringify(data));
    }).catch(err => console.error(err));
}
