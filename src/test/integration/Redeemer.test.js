// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const { parseEther } = require("ethers/lib/utils");
const {
  network,
  ethers: {
    getContract,
    getSigners,
    constants: { NegativeOne, MaxUint256 },
  },
  deployments: { fixture },
} = require("hardhat");
const { WAD } = require("../utils/constants");

process.env.TEST = true;
describe("Redeemer_integration", function () {
  let snapshotId;
  let deployer, caller, Redeemer, earlyPmx, pmx;
  before(async function () {
    await fixture(["Test"]);
    Redeemer = await getContract("Redeemer");
    earlyPmx = await getContract("EPMXToken");
    pmx = await getContract("PMXToken");
    await earlyPmx.addAddressToWhitelist(Redeemer.address);
    [deployer, caller] = await getSigners();
    await pmx.transfer(Redeemer.address, await pmx.balanceOf(deployer.address));
    await earlyPmx.addAddressToWhitelist(caller.address);
    await earlyPmx.transfer(caller.address, parseEther("1"));
  });
  describe("Redeem", function () {
    let transferAmount;
    before(async function () {
      await earlyPmx.connect(caller).approve(Redeemer.address, MaxUint256);
      transferAmount = await earlyPmx.connect(caller).balanceOf(caller.address);
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
    it("Should redeem and transfer early tokens to the Redeemer contract and burn it", async function () {
      await expect(() => Redeemer.connect(caller).redeem()).to.changeTokenBalances(
        earlyPmx,
        [caller, Redeemer],
        [transferAmount.mul(NegativeOne), 0],
      );
    });
    it("Should redeem and emit Burn event", async function () {
      await expect(Redeemer.connect(caller).redeem()).to.emit(earlyPmx, "Burn").withArgs(Redeemer.address, transferAmount);
    });
    it("Should redeem and transfer pmx tokens to the caller address", async function () {
      const expectedAmount = await transferAmount.mul(await Redeemer.rate()).div(WAD.toString());
      await expect(() => Redeemer.connect(caller).redeem()).to.changeTokenBalances(
        pmx,
        [Redeemer, caller],
        [expectedAmount.mul(NegativeOne), expectedAmount],
      );
    });
    it("Should redeem and transfer pmx tokens to the caller address with x2 rate", async function () {
      const newRate = parseEther("2");
      await Redeemer.changeRate(newRate);
      const expectedAmount = await transferAmount.mul("2");
      await expect(() => Redeemer.connect(caller).redeem()).to.changeTokenBalances(
        pmx,
        [Redeemer, caller],
        [expectedAmount.mul(NegativeOne), expectedAmount],
      );
    });
    it("Should redeem and transfer pmx tokens to the caller address with 0.5 rate", async function () {
      const newRate = parseEther("0.5");
      await Redeemer.changeRate(newRate);
      const expectedAmount = await transferAmount.div("2");
      await expect(() => Redeemer.connect(caller).redeem()).to.changeTokenBalances(
        pmx,
        [Redeemer, caller],
        [expectedAmount.mul(NegativeOne), expectedAmount],
      );
    });
  });
});
