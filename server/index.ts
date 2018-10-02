// tslint:disable:no-console

import * as grist from 'grist-plugin-api';
import {sumBy, times} from 'lodash';
import * as Shopify from 'shopify-api-node';
import {applyUpdates, fetchTable, IColumn, ITableData, prepareUpdates} from './dataUpdates';

const storageApi: grist.Storage = grist.rpc.getStub('DocStorage@grist');
const docApi: grist.GristDocAPI = grist.rpc.getStub('GristDocAPI@grist');

const DestTableId = "ShopifyItems";

// This determines which columns get created in Grist for the destination table.
const columns = [
  {id: "ShopifyId",     type: "Text"    },
  {id: "ItemId",        type: "Text"    },
  {id: "ProcessedAt",   type: "DateTime"  },
  {id: "OrderNumber",   type: "Text"      },
  {id: "VariantTitle",  type: "Text"      },
  {id: "SKU",           type: "Text"      },
  {id: "Name",          type: "Text"      },
  {id: "Title",         type: "Text"      },
  {id: "Status",        type: "Text"      },
  {id: "Quantity",      type: "Numeric"   },
  {id: "Amount",        type: "Numeric"   },
  {id: "Taxes",         type: "Numeric"   },
  {id: "Discount",      type: "Numeric"   },
  {id: "RefundAmount",  type: "Numeric"   },
  {id: "CreatedAt",     type: "DateTime"  },
  {id: "UpdatedAt",     type: "DateTime"  },
  {id: "Date",          type: "Text",   formula: "$CreatedAt.date()" },
  {id: "Month",         type: "Text",   formula: "$CreatedAt.strftime('%Y-%m')" },
];

// Type of the record object we extract from the Shopify API.
interface ILineItem {
  ShopifyId: string;
  ItemId: string;
  ProcessedAt: Date;
  OrderNumber: string;
  VariantTitle: string;
  SKU: string;
  Name: string;
  Title: string;
  Status: string;
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

function includeTimeZone(type: string, tz: string): string {
  return (type === 'DateTime' ? `${type}:${tz}` : type);
}

function includeTimeZones(cols: IColumn[], tz: string): IColumn[] {
  return cols.map((c) => ({...c, type: includeTimeZone(c.type, tz)}));
}

// Updates the destination table with data from the Shopify API. Creates the table if needed.
export async function updateTable(params: IShopifyParams): Promise<IUpdateResult> {
  try {
    const credentials = await getCredentials();
    const shopify = new Shopify(credentials);
    // Get the timezone for the store: we use it for query dates, and for DateTime columns.
    const shopConfig = await shopify.shop.get();
    const tz = shopConfig.timezone.split(/\s+/).pop()!;
    console.log(`TimeZone is ${tz} (from '${shopConfig.timezone}')`);
    const localTable: ITableData = await fetchTable(docApi, DestTableId, includeTimeZones(columns, tz));
    const fetched: ILineItem[] = await fetchLineItems(shopify, params);

    const updates = prepareUpdates('ShopifyId', localTable, fetched);
    await applyUpdates(docApi, DestTableId, updates);
    return {added: updates.additions.length, updated: updates.changes.size};
  } catch (e) {
    console.log("updateTable failed:", e);
    throw e;
  }
}

// Helper that gets Shopify credentials from storageApi.
async function getCredentials(): Promise<Shopify.IPrivateShopifyConfig> {
  const [credentials, apiSecret] = await Promise.all([
    storageApi.getItem('shopify-credentials'),
    storageApi.getItem('shopify-apiSecret'),
  ]);
  return {
    shopName: credentials.storeName,
    apiKey: credentials.apiKey,
    password: apiSecret,
  };
}

// Pulls Shopify orders and converts them to ILineItem records.
export async function fetchLineItems(shopify: Shopify, params: IShopifyParams): Promise<ILineItem[]> {
  const limit = 250;    // Max allowed per call.
  const apiParams = {
    updated_at_min: params.startDate,
    updated_at_max: params.endDate,
    status: 'any',
  };
  const count: number = await shopify.order.count(apiParams);
  const numPages: number = Math.ceil(count / limit);
  console.log(`Shopify has ${count} orders, requesting ${numPages} pages`);
  const records: ILineItem[] = [];
  await Promise.all(times(numPages, async (index: number) => {
    // Note that page numbers are 1-based.
    const orders = await shopify.order.list({...apiParams, limit, page: index + 1});
    for (const order of orders) {
      processOrder(records, order);
    }
  }));
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
      ShopifyId:    String(item.id),
      ItemId:       String(item.id),
      ProcessedAt:  new Date(order.processed_at),
      OrderNumber:  String(order.order_number),
      VariantTitle: item.variant_title,
      SKU:          item.sku,
      Name:         item.name,
      Title:        item.title,
      Status:       order.financial_status,
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
      const item: Shopify.IOrderLineItem = rli.line_item;
      const discount = sumBy((item as any).discount_allocations, (r: any) => parseFloat(r.amount));
      const taxes = sumBy(item.tax_lines as any, (r: any) => parseFloat(r.price));
      const price = parseFloat(item.price);
      records.push({
        ShopifyId:    "R-" + String(rli.id),
        ItemId:       String(item.id),
        ProcessedAt:  new Date(refund.processed_at),
        OrderNumber:  String(order.order_number),
        VariantTitle: item.variant_title,
        SKU:          item.sku,
        Name:         item.name,
        Title:        item.title,
        Status:       order.financial_status,
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
