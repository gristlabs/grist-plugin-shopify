// tslint:disable:no-console

import * as grist from 'grist-plugin-api';
import {sumBy} from 'lodash';
import * as Shopify from 'shopify-api-node';
import {applyUpdates, fetchTable, ITableData, prepareUpdates} from './dataUpdates';

const storageApi: grist.Storage = grist.rpc.getStub('DocStorage@grist');
const docApi: grist.GristDocAPI = grist.rpc.getStub('GristDocAPI@grist');

const DestTableId = "ShopifyItems";

// This determines which columns get created in Grist for the destination table.
const columns = [
  {id: "ShopifyId",     type: "Text"    },
  {id: "ProcessedAt",   type: "DateTime"  },
  {id: "OrderNumber",   type: "Text"      },
  {id: "VariantTitle",  type: "Text"      },
  {id: "SKU",           type: "Text"      },
  {id: "Name",          type: "Text"      },
  {id: "Title",         type: "Text"      },
  {id: "Quantity",      type: "Numeric"   },
  {id: "Amount",        type: "Numeric"   },
  {id: "Taxes",         type: "Numeric"   },
  {id: "Discount",      type: "Numeric"   },
  {id: "RefundAmount",  type: "Numeric"   },
  {id: "CreateAt",      type: "DateTime"  },
  {id: "UpdatedAt",     type: "DateTime"  },
];

// Type of the record object we extract from the Shopify API.
interface ILineItem {
  ShopifyId: number;
  ProcessedAt: Date;
  OrderNumber: string;
  VariantTitle: string;
  SKU: string;
  Name: string;
  Title: string;
  Quantity: number;
  Amount: number;
  Taxes: number;
  Discount: number;
  RefundAmount: number;
  CreatedAt: Date;
  UpdatedAt: Date;
}

// Type of the parameters to updateTable() call.
interface IShopifyParams {
  startDate: Date;
  endDate: Date;
}

// Type of the result of updateTable() call.
interface IUpdateResult {
  updated: number;
  added: number;
}

// Updates the destination table with data from the Shopify API. Creates the table if needed.
export async function updateTable(params: IShopifyParams): Promise<IUpdateResult> {
  const credentials = await getCredentials();
  const shopify = new Shopify(credentials);
  const localTable: ITableData = await fetchTable(docApi, DestTableId, columns);
  const fetched: ILineItem[] = await fetchLineItems(shopify, params);

  const updates = prepareUpdates('ShopifyId', localTable, fetched);
  await applyUpdates(docApi, DestTableId, updates);
  return {added: updates.additions.length, updated: updates.changes.size};
}

// Helper that gets Shopify credentials from storageApi.
async function getCredentials(): Promise<Shopify.IPrivateShopifyConfig> {
  const [credentials, apiSecret] = await Promise.all([
    storageApi.getItem('shopify-credentials'),
    storageApi.getItem('shopify-apiSecret'),
  ]);
  return {...credentials, apiSecret};
}

// Pulls Shopify orders and converts them to ILineItem records.
export async function fetchLineItems(shopify: Shopify, params: IShopifyParams): Promise<ILineItem[]> {
  const limit = 250;    // Max allowed per call.
  const status = 'any';
  const records: ILineItem[] = [];
  for (let page = 1; ; page++) {
    const orders = await shopify.order.list({...params, status, limit, page});
    for (const order of orders) {
      processOrder(records, order);
    }
    if (orders.length < limit) {
      break;
    }
  }
  return records;
}

// Converts an individual Shopify order into one or more ILineItem records. Creates a new record
// for each line item in the order, and for each line item of every refund (if any).
function processOrder(records: ILineItem[], order: Shopify.IOrder): void {
  for (const item of order.line_items) {
    // Typescript types for IOrderLineItem are off or out of date for discount_allocations and tax_lines.
    const discount = sumBy((item as any).discount_allocations, (r: any) => parseFloat(r.amount));
    const taxes = sumBy(item.tax_lines as any, (r: any) => parseFloat(r.price));
    const price = parseFloat(item.price);
    records.push({
      ShopifyId:    item.id,
      ProcessedAt:  new Date(order.processed_at),
      OrderNumber:  String(order.order_number),
      VariantTitle: item.variant_title,
      SKU:          item.sku,
      Name:         item.name,
      Title:        item.title,
      Quantity:     item.quantity,
      Amount:       price * item.quantity,
      Taxes:        taxes,
      Discount:     discount,
      RefundAmount: 0,
      CreatedAt:    new Date(order.created_at),
      UpdatedAt:    new Date(order.updated_at),
    });
  }
  for (const refund of order.refunds) {
    for (const rli of refund.refund_line_items) {
      const item = rli.line_item;
      const discount = sumBy(item.discount_allocations, (r: any) => parseFloat(r.amount));
      const taxes = sumBy(item.tax_lines, (r: any) => parseFloat(r.price));
      const price = parseFloat(item.price);
      records.push({
        ShopifyId:    item.id,
        ProcessedAt:  new Date(refund.processed_at),
        OrderNumber:  String(order.order_number),
        VariantTitle: item.variant_title,
        SKU:          item.sku,
        Name:         item.name,
        Title:        item.title,
        Quantity:     -item.quantity,
        Amount:       0,
        Taxes:        taxes,
        Discount:     0,
        RefundAmount: price * item.quantity - discount,
        CreatedAt:    new Date(refund.created_at),
        UpdatedAt:    new Date(refund.processed_at),    // no separate value for this
      });
    }
  }
}

grist.rpc.registerFunc('updateTable', updateTable);
grist.ready();
