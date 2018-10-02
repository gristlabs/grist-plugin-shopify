import {assert} from 'chai';
import * as sinon from 'sinon';
import {fetchLineItems} from '../server/index';

// This is a simple way to bring in some JSON data (using import would require a type declaration).
// tslint:disable-next-line:no-var-requires
const sampleOrders = require('./fixtures/sample_orders.json');

describe('shopify', function() {
  describe('fetchLineItems', function() {
    it('should turn shopify orders into correct records', async function() {
      const listMethod = sinon.stub();
      const countMethod = sinon.stub();
      listMethod.callsFake(() => Promise.resolve(sampleOrders.orders));
      countMethod.callsFake(() => Promise.resolve(sampleOrders.orders.length));
      const shopify: any = {order: {list: listMethod, count: countMethod}};

      const startDate = new Date("2000-01-01");   // These are ignored by the stub.
      const endDate = new Date("2000-02-01");
      const lineItems = await fetchLineItems(shopify, {startDate, endDate});

      assert.deepEqual(lineItems, [{
        Amount: 22.99,
        CreatedAt: new Date("2018-08-31T20:06:00.000Z"),
        Discount: 2.29,
        Name: "Pretty Item - Blue",
        OrderNumber: "1123",
        ProcessedAt: new Date("2018-08-31T20:06:00.000Z"),
        Quantity: 1,
        RefundAmount: 0,
        SKU: "pretty-item-123",
        ShopifyId: "234234234",
        ItemId: "234234234",
        Taxes: 0,
        Title: "Pretty Item",
        UpdatedAt: new Date("2018-09-11T22:46:00.000Z"),
        VariantTitle: "Blue",
        Status: "paid",
      }, {
        Amount: 22.99,
        CreatedAt: new Date("2018-08-23T01:00:00.000Z"),
        Discount: 2.29,
        Name: "Warm Clothes - Red",
        OrderNumber: "1345",
        ProcessedAt: new Date("2018-08-23T01:00:00.000Z"),
        Quantity: 1,
        RefundAmount: 0,
        SKU: "warm-clothes-red",
        ShopifyId: "543543543",
        ItemId: "543543543",
        Taxes: 0,
        Title: "Warm Clothes",
        UpdatedAt: new Date("2018-08-27T22:00:00.000Z"),
        VariantTitle: "Red",
        Status: "refunded",
      }, {
        Amount: 0,
        CreatedAt: new Date("2018-08-27T22:00:00.000Z"),
        Discount: 0,
        Name: "Warm Clothes - Red",
        OrderNumber: "1345",
        ProcessedAt: new Date("2018-08-27T22:00:00.000Z"),
        Quantity: -1,
        RefundAmount: 20.7,
        SKU: "warm-clothes-red",
        ShopifyId: "R-500500500",
        ItemId: "543543543",
        Taxes: 0,
        Title: "Warm Clothes",
        UpdatedAt: new Date("2018-08-27T22:00:00.000Z"),
        VariantTitle: "Red",
        Status: "refunded",
      }, {
        Amount: 24.99,
        CreatedAt: new Date("2018-08-31T19:40:00.000Z"),
        Discount: 12.49,
        Name: "Sturdy Thing - Flat",
        OrderNumber: "1234",
        ProcessedAt: new Date("2018-08-31T19:40:00.000Z"),
        Quantity: 1,
        RefundAmount: 0,
        SKU: "sturdy-thing-flat",
        ShopifyId: "678678678",
        ItemId: "678678678",
        Taxes: 0,
        Title: "Sturdy Thing",
        UpdatedAt: new Date("2018-09-13T14:30:00.000Z"),
        VariantTitle: "Flat",
        Status: "partially_refunded",
      }]);
    });
  });
});
