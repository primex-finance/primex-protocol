// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");

const {
  network,
  ethers: {
    getContract,
    utils: { parseEther },
  },
  deployments: { fixture },
} = require("hardhat");

const { getTakeProfitStopLossParams } = require("../utils/conditionParams");

process.env.TEST = true;

describe("TakeProfitStopLossCCM_unit", function () {
  let snapshotId, takeProfitStopLossCCM;

  before(async function () {
    await fixture(["Test"]);

    takeProfitStopLossCCM = await getContract("TakeProfitStopLossCCM");
  });

  beforeEach(async function () {
    snapshotId = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });
  afterEach(async function () {
    await network.provider.request({
      method: "evm_revert",
      params: [snapshotId],
    });
  });

  describe("getTakeProfitStopLossPrices", function () {
    it("Should decode TakeProfit, StopLoss price", async function () {
      const tp = parseEther("10");
      const sl = parseEther("5");
      const encodedParams = getTakeProfitStopLossParams(tp, sl);

      expect(await takeProfitStopLossCCM.getTakeProfitStopLossPrices(encodedParams)).to.eql([tp, sl]);
    });
  });
});
