import {assert} from 'chai';
import * as sinon from 'sinon';
import * as dataUpdates from '../server/dataUpdates';

describe('dataUpdates', function() {
  describe('prepareUpdates', function() {
    it('should create additions and updates', function() {
      const local1 = {
        id: [1, 2, 5, 6],
        foo: [10, 20, 30, 40],
        city: ["New York", "Boston", "New York", "Chicago"],
      };
      const fetched1 = [
        {foo: 10, city: "New York"},
        {foo: 30, city: "New Haven"},
        {foo: 15, city: "Hartford"},
        {foo: 50, city: "Seattle"},
        {foo: 20, city: "boston"},
      ];
      const result = dataUpdates.prepareUpdates("foo", local1, fetched1);
      assert.deepEqual(result.additions, [
        {foo: 15, city: "Hartford"},
        {foo: 50, city: "Seattle"},
      ]);
      assert.deepEqual(Array.from(result.changes), [
        [5, {foo: 30, city: "New Haven"}],
        [2, {foo: 20, city: "boston"}],
      ]);
    });
  });

  describe("applyUpdates", function() {
    it("should produce correct UserActions", async function() {
      const docApi = {applyUserActions: sinon.spy()} as any;
      await dataUpdates.applyUpdates(docApi, "MyTable", {
        additions: [
          {foo: 15, city: "Hartford"},
          {foo: 50, city: "Seattle"},
        ],
        changes: new Map([
          [5, {foo: 30, city: "New Haven"}],
          [2, {foo: 20, city: "boston"}],
        ]),
      });
      sinon.assert.calledOnce(docApi.applyUserActions);
      assert.deepEqual(docApi.applyUserActions.getCall(0).args[0], [
        ['BulkAddRecord', "MyTable", [null, null], {foo: [15, 50], city: ["Hartford", "Seattle"]}],
        ['BulkUpdateRecord', "MyTable", [5, 2], {foo: [30, 20], city: ["New Haven", "boston"]}],
      ]);
    });

    it("should skip empty actions", async function() {
      const docApi = {applyUserActions: sinon.spy()} as any;
      await dataUpdates.applyUpdates(docApi, "MyTable", {
        additions: [],
        changes: new Map([[5, {foo: 30, city: "New Haven"}]]),
      });
      sinon.assert.calledOnce(docApi.applyUserActions);
      assert.deepEqual(docApi.applyUserActions.getCall(0).args[0], [
        ['BulkUpdateRecord', "MyTable", [5], {foo: [30], city: ["New Haven"]}],
      ]);
      docApi.applyUserActions.resetHistory();

      await dataUpdates.applyUpdates(docApi, "MyTable", {
        additions: [
          {foo: 50, city: "Seattle"},
        ],
        changes: new Map(),
      });
      sinon.assert.calledOnce(docApi.applyUserActions);
      assert.deepEqual(docApi.applyUserActions.getCall(0).args[0], [
        ['BulkAddRecord', "MyTable", [null], {foo: [50], city: ["Seattle"]}],
      ]);
      docApi.applyUserActions.resetHistory();

      await dataUpdates.applyUpdates(docApi, "MyTable", {
        additions: [],
        changes: new Map(),
      });
      sinon.assert.notCalled(docApi.applyUserActions);
    });
  });
});
