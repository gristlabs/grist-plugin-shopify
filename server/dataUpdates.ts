import {GristDocAPI} from 'grist-plugin-api';
import {mapValues} from 'lodash';

export interface ITableData {
  [colId: string]: any[];
}

export interface IRecord {
  [colId: string]: any;
}

export interface IPreparedUpdates {
  changes: Map<number, IRecord>;    // Maps existing rowId to the updated record.
  additions: IRecord[];             // Lists new records.
}

export interface IColumn {
  id: string;
  type: string;
}

/**
 * Fetch table tableId. If it does not exists, creates one with the given columns.
 */
export async function fetchTable(docApi: GristDocAPI, tableId: string, columns: IColumn[]): Promise<ITableData> {
  const tables = await docApi.listTables();
  if (!tables.includes(tableId)) {
    await docApi.applyUserActions([['AddTable', tableId, columns]]);
  }
  return docApi.fetchTable(tableId);
}

/**
 * Given a keyId naming a column to serve as the primary key, and existing table data, prepares a
 * set of additions and changes to the table.
 */
export function prepareUpdates(keyId: string, local: ITableData, fetched: IRecord[]): IPreparedUpdates {
  // Maps rowId to updated Record.
  const changes: Map<number, IRecord> = new Map();
  const additions: IRecord[] = [];

  // Maps key to index of record in local ITableData columns.
  const localByKey: Map<any, number> =
    new Map(local[keyId].map<[any, number]>((value, index) => [value, index]));

  for (const rec of fetched) {
    const key = rec[keyId];
    const localIndex = localByKey.get(key);
    if (localIndex !== undefined) {
      if (Object.keys(rec).some((k) => (convert(rec[k]) !== local[k][localIndex]))) {
        changes.set(local.id[localIndex], rec);
      }
    } else {
      additions.push(rec);
    }
  }
  return {changes, additions};
}

/**
 * Applies the set of updates returned by prepareUpdates().
 */
export async function applyUpdates(docApi: GristDocAPI, tableId: string, updates: IPreparedUpdates): Promise<void> {
  const {changes, additions} = updates;
  const userActions: any[][] = [];
  if (additions.length) {
    const rowIds = additions.map(() => null);   // All rowIds can be null.
    userActions.push(['BulkAddRecord', tableId, rowIds, recordsToData(additions)]);
  }
  if (changes.size) {
    const rowIds = Array.from(changes.keys());
    userActions.push(['BulkUpdateRecord', tableId, rowIds, recordsToData(Array.from(changes.values()))]);
  }
  if (userActions.length) {
    await docApi.applyUserActions(userActions);
  }
}

function recordsToData<Record extends {[key: string]: any}>(records: Record[]): ITableData {
  if (!records.length) { return {}; }
  return mapValues(records[0], (val, key) => records.map((r) => convert(r[key])));
}

function convert(value: any): any {
  if (value instanceof Date) {
    // Convert dates to seconds since Epoch, as needed by Grist Date and DateTime columns.
    return value.getTime() / 1000;
  }
  return value;
}
