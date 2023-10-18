// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");

const {
  run,
  network,
  ethers: {
    provider,
    getContract,
    getNamedSigners,
    utils: { parseEther, parseUnits },
    constants: { NegativeOne },
  },
  deployments: { fixture },
} = require("hardhat");
const { NATIVE_CURRENCY } = require("../utils/constants");
const { parseArguments } = require("../utils/eventValidation");

process.env.TEST = true;

describe("Treasury_integration", function () {
  let pmx, treasury, testTokenA, errorsLibrary;
  let deployer, trader;
  let spendingLimits, maxAmountPerTransfer, maxPercentPerTransfer, minTimeBetweenTransfers;
  let timeframeDuration, maxAmountDuringTimeframe, maxTotalAmount;
  let amountOfETH, amountOfToken;
  let snapshotId;
  let decimalsA, decimalsPMX;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader } = await getNamedSigners());

    treasury = await getContract("Treasury");
    errorsLibrary = await getContract("Errors");

    await run("deploy:ERC20Mock", {
      name: "TestTokenA",
      symbol: "TTA",
      decimals: "18",
      initialAccounts: JSON.stringify([treasury.address]),
      initialBalances: JSON.stringify(["100"]),
    });
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();

    pmx = await getContract("EPMXToken");
    decimalsPMX = await pmx.decimals();

    amountOfETH = parseEther("100");
    amountOfToken = parseEther("100");
    const tx = await deployer.sendTransaction({
      to: treasury.address,
      value: amountOfETH,
    });
    await tx.wait();
    await pmx.transfer(treasury.address, amountOfToken);
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

  describe("transferFromTreasury", function () {
    beforeEach(async function () {
      maxAmountPerTransfer = parseEther("2");
      maxPercentPerTransfer = parseEther("0.3");
      minTimeBetweenTransfers = 60 * 60 * 6; // 6 hours
      timeframeDuration = 60 * 60 * 24; // 1 day
      maxAmountDuringTimeframe = parseEther("10");
      maxTotalAmount = parseEther("50");
      spendingLimits = {
        maxTotalAmount: maxTotalAmount,
        maxAmountPerTransfer: maxAmountPerTransfer,
        maxPercentPerTransfer: maxPercentPerTransfer,
        minTimeBetweenTransfers: minTimeBetweenTransfers,
        timeframeDuration: timeframeDuration,
        maxAmountDuringTimeframe: maxAmountDuringTimeframe,
      };

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

    it("Should revert when amount > maxAmountDuringTimeframe during current timeFrame", async function () {
      spendingLimits.maxAmountPerTransfer = parseEther("3");
      spendingLimits.maxAmountDuringTimeframe = parseEther("2");

      const amount = parseEther("3");
      await treasury.connect(deployer).setMaxSpendingLimit(trader.address, pmx.address, spendingLimits);
      await treasury.connect(deployer).setMaxSpendingLimit(trader.address, testTokenA.address, spendingLimits);
      await treasury.connect(deployer).setMaxSpendingLimit(trader.address, NATIVE_CURRENCY, spendingLimits);

      await network.provider.send("evm_increaseTime", [minTimeBetweenTransfers]);
      await network.provider.send("evm_mine");

      await expect(treasury.connect(trader).transferFromTreasury(amount, pmx.address, trader.address)).to.be.revertedWithCustomError(
        errorsLibrary,
        "EXCEEDED_MAX_AMOUNT_DURING_TIMEFRAME",
      );
      await expect(treasury.connect(trader).transferFromTreasury(amount, testTokenA.address, trader.address)).to.be.revertedWithCustomError(
        errorsLibrary,
        "EXCEEDED_MAX_AMOUNT_DURING_TIMEFRAME",
      );
      await expect(treasury.connect(trader).transferFromTreasury(amount, NATIVE_CURRENCY, trader.address)).to.be.revertedWithCustomError(
        errorsLibrary,
        "EXCEEDED_MAX_AMOUNT_DURING_TIMEFRAME",
      );
    });
    it("Should revert when amount > maxAmountDuringTimeframe", async function () {
      spendingLimits.maxAmountPerTransfer = parseEther("3");
      spendingLimits.maxAmountDuringTimeframe = parseEther("2");

      const amount = parseEther("3");
      await treasury.connect(deployer).setMaxSpendingLimit(trader.address, pmx.address, spendingLimits);
      await treasury.connect(deployer).setMaxSpendingLimit(trader.address, testTokenA.address, spendingLimits);
      await treasury.connect(deployer).setMaxSpendingLimit(trader.address, NATIVE_CURRENCY, spendingLimits);

      const increaseTime = 60 * 60 * 48; // 2days
      await network.provider.send("evm_increaseTime", [increaseTime]);
      await network.provider.send("evm_mine");

      await expect(treasury.connect(trader).transferFromTreasury(amount, pmx.address, trader.address)).to.be.revertedWithCustomError(
        errorsLibrary,
        "EXCEEDED_MAX_AMOUNT_DURING_TIMEFRAME",
      );
      await expect(treasury.connect(trader).transferFromTreasury(amount, testTokenA.address, trader.address)).to.be.revertedWithCustomError(
        errorsLibrary,
        "EXCEEDED_MAX_AMOUNT_DURING_TIMEFRAME",
      );
      await expect(treasury.connect(trader).transferFromTreasury(amount, NATIVE_CURRENCY, trader.address)).to.be.revertedWithCustomError(
        errorsLibrary,
        "EXCEEDED_MAX_AMOUNT_DURING_TIMEFRAME",
      );
    });
    it("Should set withdrawnDuringTimeframe == amount when amount <= maxAmountDuringTimeframe", async function () {
      spendingLimits.maxAmountPerTransfer = parseEther("3");
      spendingLimits.maxAmountDuringTimeframe = parseEther("2");

      const amountPmx = parseUnits("1", decimalsPMX);
      const amountTokenA = parseUnits("1", decimalsA);
      const amountNative = amountPmx;

      await treasury.connect(deployer).setMaxSpendingLimit(trader.address, pmx.address, spendingLimits);
      await treasury.connect(deployer).setMaxSpendingLimit(trader.address, testTokenA.address, spendingLimits);
      await treasury.connect(deployer).setMaxSpendingLimit(trader.address, NATIVE_CURRENCY, spendingLimits);

      const increaseTime = 60 * 60 * 48; // 2days
      await network.provider.send("evm_increaseTime", [increaseTime]);
      await network.provider.send("evm_mine");

      await treasury.connect(trader).transferFromTreasury(amountPmx, pmx.address, trader.address);
      await treasury.connect(trader).transferFromTreasury(amountTokenA, testTokenA.address, trader.address);
      await treasury.connect(trader).transferFromTreasury(amountNative, NATIVE_CURRENCY, trader.address);

      const spenderInfoPmx = await treasury.spenders(trader.address, pmx.address);
      const spenderInfoTestA = await treasury.spenders(trader.address, testTokenA.address);
      const spenderInfoNative = await treasury.spenders(trader.address, NATIVE_CURRENCY);

      expect(spenderInfoPmx.withdrawnDuringTimeframe).to.equal(amountPmx);
      expect(spenderInfoTestA.withdrawnDuringTimeframe).to.equal(amountTokenA);
      expect(spenderInfoNative.withdrawnDuringTimeframe).to.equal(amountNative);
    });

    it("Should transfer pmx to the recipient and reduce contract balance", async function () {
      const amount = parseEther("2");
      await pmx.connect(deployer).addAddressToWhitelist(trader.address);
      await treasury.connect(deployer).setMaxSpendingLimit(trader.address, pmx.address, spendingLimits);

      expect(await pmx.balanceOf(treasury.address)).to.equal(amountOfToken);

      await network.provider.send("evm_increaseTime", [minTimeBetweenTransfers]);
      await network.provider.send("evm_mine");

      await expect(() => treasury.connect(trader).transferFromTreasury(amount, pmx.address, trader.address)).to.changeTokenBalances(
        pmx,
        [treasury, trader],
        [amount.mul(NegativeOne), amount],
      );
    });
    it("Should transfer NATIVE_CURRENCY to the recipient and reduce contract balance", async function () {
      const amount = parseEther("2");
      await treasury.connect(deployer).setMaxSpendingLimit(trader.address, NATIVE_CURRENCY, spendingLimits);

      expect(await provider.getBalance(treasury.address)).to.equal(amountOfETH);

      await network.provider.send("evm_increaseTime", [minTimeBetweenTransfers]);
      await network.provider.send("evm_mine");

      await expect(() => treasury.connect(trader).transferFromTreasury(amount, NATIVE_CURRENCY, trader.address)).to.changeEtherBalances(
        [treasury, trader],
        [amount.mul(NegativeOne), amount],
      );
    });
    it("Should emit TransferFromTreasury event if transferFromTreasury is successful", async function () {
      const amount = parseEther("2");
      await treasury.connect(deployer).setMaxSpendingLimit(trader.address, testTokenA.address, spendingLimits);

      await network.provider.send("evm_increaseTime", [minTimeBetweenTransfers]);
      await network.provider.send("evm_mine");

      const transferFromTreasury = await treasury.connect(trader).transferFromTreasury(amount, testTokenA.address, trader.address);

      await expect(transferFromTreasury)
        .to.emit(treasury, "TransferFromTreasury")
        .withArgs(trader.address, trader.address, testTokenA.address, amount);
    });
    it("Should set correct spendingInfo for spender after call setMaxSpendingLimit second time", async function () {
      const amount = parseEther("2");
      const newSpendingLimits = {
        maxTotalAmount: parseEther("55"),
        maxAmountPerTransfer: parseEther("3"),
        maxPercentPerTransfer: parseEther("0.6"),
        minTimeBetweenTransfers: 60 * 60 * 12, // 12 hours,
        timeframeDuration: 60 * 60 * 48, // 1 day,
        maxAmountDuringTimeframe: parseEther("4"),
      };
      await treasury.connect(deployer).setMaxSpendingLimit(trader.address, NATIVE_CURRENCY, spendingLimits);

      await network.provider.send("evm_increaseTime", [minTimeBetweenTransfers]);
      await network.provider.send("evm_mine");

      await treasury.connect(trader).transferFromTreasury(amount, NATIVE_CURRENCY, trader.address);
      const blockNumber = await provider.getBlockNumber();
      const block = await provider.getBlock(blockNumber);

      await network.provider.send("evm_increaseTime", [minTimeBetweenTransfers]);
      await network.provider.send("evm_mine");
      await treasury.connect(deployer).setMaxSpendingLimit(trader.address, NATIVE_CURRENCY, newSpendingLimits);
      const spenderInfo = await treasury.spenders(trader.address, NATIVE_CURRENCY);

      const expectedSpenderInfo = {
        isSpenderExist: true,
        limits: newSpendingLimits,
        lastWithdrawalTimestamp: block.timestamp,
        withdrawnDuringTimeframe: amount,
      };
      parseArguments(expectedSpenderInfo, spenderInfo);
    });
  });
});
