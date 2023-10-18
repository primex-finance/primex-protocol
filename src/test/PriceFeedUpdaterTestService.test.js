// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    getContract,
    getContractFactory,
    getNamedSigners,
    utils: { keccak256, toUtf8Bytes, parseUnits },
    constants: { AddressZero, HashZero },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

process.env.TEST = true;
const { getAmountsOut, addLiquidity } = require("./utils/dexOperations");
const { deployMockDexAdapter } = require("./utils/waffleMocks");

// all avialable dex
const dexes = ["uniswap", "sushiswap", "uniswapv3"];
const DEFAULT_UPDATER_ROLE = keccak256(toUtf8Bytes("DEFAULT_UPDATER_ROLE"));

async function averageDexPrice(tokenIn, tokenOut, divider) {
  let amount0Out = BigNumber.from("0");
  let denominator = 0;
  for (let i = 0; i < dexes.length; i++) {
    try {
      amount0Out = amount0Out.add(
        await getAmountsOut(dexes[i], parseUnits("1", await tokenIn.decimals()).div(divider), [tokenIn.address, tokenOut.address]),
      );
      denominator++;
    } catch {}
  }
  if (denominator === 0) throw new Error("denominator is 0");
  return amount0Out.mul(divider).div(denominator).mul(100);
}

describe("PriceFeedUpdaterTestService", function () {
  let PriceFeedUpdaterTestService, priceFeed, priceFeed2, priceFeed3, DexAdapter, divider;
  let testTokenA, testTokenB, testTokenX;
  let lender, deployer, snapshotIdBase;
  let mockDexAdapter;
  let ErrorsLibrary;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, lender } = await getNamedSigners());

    PriceFeedUpdaterTestService = await getContract("PriceFeedUpdaterTestService");
    DexAdapter = await getContract("DexAdapter");
    ErrorsLibrary = await getContract("Errors");
    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    await run("deploy:PrimexAggregatorV3TestService", { name: "TEST2", updater: PriceFeedUpdaterTestService.address });
    await run("deploy:PrimexAggregatorV3TestService", { name: "TEST3", updater: PriceFeedUpdaterTestService.address });
    priceFeed2 = await getContract("PrimexAggregatorV3TestService TEST2 price feed");
    priceFeed3 = await getContract("PrimexAggregatorV3TestService TEST3 price feed");

    await run("deploy:ERC20Mock", {
      name: "TestTokenX",
      symbol: "TTX",
      decimals: "18",
    });

    testTokenA = await getContract("TestTokenA");
    testTokenB = await getContract("TestTokenB");
    testTokenX = await getContract("TestTokenX");

    for (let i = 0; i < dexes.length; i++) {
      await addLiquidity({ dex: dexes[i], from: "lender", tokenA: testTokenA, tokenB: testTokenB });
      await addLiquidity({ dex: dexes[i], from: "lender", tokenA: testTokenA, tokenB: testTokenX });
      await addLiquidity({ dex: dexes[i], from: "lender", tokenA: testTokenX, tokenB: testTokenB });
    }

    divider = await PriceFeedUpdaterTestService.divider();

    mockDexAdapter = await deployMockDexAdapter(deployer);

    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  afterEach(async function () {
    await network.provider.request({
      method: "evm_revert",
      params: [snapshotIdBase],
    });
    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });
  describe("constructor", function () {
    let snapshotId, PriceFeedUpdaterFactory, primexPricingLibrary;
    before(async function () {
      primexPricingLibrary = await getContract("PrimexPricingLibrary");
      PriceFeedUpdaterFactory = await getContractFactory("PriceFeedUpdaterTestService", {
        libraries: {
          PrimexPricingLibrary: primexPricingLibrary.address,
        },
      });
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

    it("Should deploy", async function () {
      await PriceFeedUpdaterFactory.deploy(lender.address, DexAdapter.address, []);
    });

    it("Should revert deploy when updater is zero address", async function () {
      await expect(PriceFeedUpdaterFactory.deploy(AddressZero, DexAdapter.address, [])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });

    it("Should revert deploy when dexAdapter address not supported", async function () {
      await mockDexAdapter.mock.supportsInterface.returns(false);
      await expect(PriceFeedUpdaterFactory.deploy(lender.address, mockDexAdapter.address, [])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
    it("Should revert deploy when router is zero address", async function () {
      await expect(PriceFeedUpdaterFactory.deploy(lender.address, DexAdapter.address, [AddressZero])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
  });

  it("should checkArrayPriceFeed and return correct price feeds statuses", async function () {
    const priceFeedA = [testTokenA.address, testTokenB.address, priceFeed.address];
    const priceFeedB = [testTokenA.address, testTokenX.address, priceFeed2.address];
    const priceFeedC = [testTokenX.address, testTokenB.address, priceFeed3.address];

    const priceFeeds = [priceFeedA, priceFeedB, priceFeedC];
    const PriceFeedsStatuses = await PriceFeedUpdaterTestService.callStatic.checkArrayPriceFeed(priceFeeds);
    expect(PriceFeedsStatuses[0].isNeedUpdate).to.equal(true);
    expect(PriceFeedsStatuses[0].priceFeed).to.equal(priceFeed.address);
    expect(PriceFeedsStatuses[0].lastAverageDexPrice).to.equal(await averageDexPrice(testTokenA, testTokenB, divider));

    expect(PriceFeedsStatuses[1].isNeedUpdate).to.equal(true);
    expect(PriceFeedsStatuses[1].priceFeed).to.equal(priceFeed2.address);
    expect(PriceFeedsStatuses[1].lastAverageDexPrice).to.equal(await averageDexPrice(testTokenA, testTokenX, divider));

    expect(PriceFeedsStatuses[2].isNeedUpdate).to.equal(true);
    expect(PriceFeedsStatuses[2].priceFeed).to.equal(priceFeed3.address);
    expect(PriceFeedsStatuses[2].lastAverageDexPrice).to.equal(await averageDexPrice(testTokenX, testTokenB, divider));
  });

  describe("addRouter", function () {
    it("Should add new router", async function () {
      const routers = await PriceFeedUpdaterTestService.getRouters();
      await PriceFeedUpdaterTestService.addRouter(lender.address);
      const routersAfter = await PriceFeedUpdaterTestService.getRouters();
      expect(routers.length + 1).to.equal(routersAfter.length);
      expect(routersAfter[routersAfter.length - 1]).to.equal(lender.address);
    });

    it("Should revert if msg.sender hasn't BIG_TIMELOCK_ADMIN", async function () {
      await expect(PriceFeedUpdaterTestService.connect(lender).addRouter(lender.address)).to.be.revertedWith(
        `AccessControl: account ${lender.address.toLowerCase()} is missing role ${HashZero}`,
      );
    });

    it("Should revert when router address is 0 address", async function () {
      await expect(PriceFeedUpdaterTestService.addRouter(AddressZero)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
  });

  describe("deleteRouter", function () {
    it("Should delete router from array", async function () {
      const routers = await PriceFeedUpdaterTestService.getRouters();
      const indexToDelete = routers.length - 2;
      await PriceFeedUpdaterTestService.deleteRouter(indexToDelete);
      const routersAfter = await PriceFeedUpdaterTestService.getRouters();

      expect(routers.length - 1).to.equal(routersAfter.length);
      expect(routers[routers.length - 1]).to.equal(routersAfter[indexToDelete]);
    });

    it("Should revert if msg.sender hasn't BIG_TIMELOCK_ADMIN", async function () {
      await expect(PriceFeedUpdaterTestService.connect(lender).deleteRouter(0)).to.be.revertedWith(
        `AccessControl: account ${lender.address.toLowerCase()} is missing role ${HashZero}`,
      );
    });

    it("Should revert when router address is 0 address", async function () {
      const routers = await PriceFeedUpdaterTestService.getRouters();
      await expect(PriceFeedUpdaterTestService.deleteRouter(routers.length)).to.be.revertedWithCustomError(ErrorsLibrary, "INVALID_INDEX");
    });
  });

  describe("setDivider", function () {
    it("Should setDivider update divider", async function () {
      await PriceFeedUpdaterTestService.setDivider(divider.div(10));
      expect(await PriceFeedUpdaterTestService.divider()).to.equal(divider.div(10));
    });

    it("Should revert if msg.sender hasn't BIG_TIMELOCK_ADMIN", async function () {
      await expect(PriceFeedUpdaterTestService.connect(lender).setDivider(divider.div(10))).to.be.revertedWith(
        `AccessControl: account ${lender.address.toLowerCase()} is missing role ${HashZero}`,
      );
    });

    it("Should revert when newDivider is 0", async function () {
      await expect(PriceFeedUpdaterTestService.setDivider(0)).to.be.revertedWithCustomError(ErrorsLibrary, "INVALID_DIVIDER");
    });
  });

  describe("updateArrayPriceFeed", function () {
    it("should update price feeds and emit events", async function () {
      const newValues = [33, 4];

      await expect(PriceFeedUpdaterTestService.updateArrayPriceFeed([priceFeed.address, priceFeed2.address], newValues))
        .to.emit(priceFeed, "AnswerUpdated")
        .withArgs(newValues[0], await priceFeed.latestRound(), await priceFeed.latestTimestamp())
        .to.emit(priceFeed2, "AnswerUpdated")
        .withArgs(newValues[1], await priceFeed2.latestRound(), await priceFeed.latestTimestamp());
      expect(await priceFeed.latestAnswer()).to.equal(newValues[0]);
      expect(await priceFeed2.latestAnswer()).to.equal(newValues[1]);
    });
    it("Should revert if msg.sender hasn't BIG_TIMELOCK_ADMIN", async function () {
      await expect(PriceFeedUpdaterTestService.connect(lender).updateArrayPriceFeed([priceFeed.address], [0])).to.be.revertedWith(
        `AccessControl: account ${lender.address.toLowerCase()} is missing role ${DEFAULT_UPDATER_ROLE}`,
      );
    });
    it("Should revert two arguments lengths is not equal", async function () {
      await expect(
        PriceFeedUpdaterTestService.updateArrayPriceFeed([priceFeed.address, priceFeed2.address], [0]),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ARRAYS_LENGTHS_IS_NOT_EQUAL");
    });
  });

  describe("updatePriceFeed", function () {
    it("should update price feed and emit event", async function () {
      const newValue = 79;
      await expect(PriceFeedUpdaterTestService.updatePriceFeed(priceFeed.address, newValue))
        .to.emit(priceFeed, "AnswerUpdated")
        .withArgs(newValue, await priceFeed.latestRound(), await priceFeed.latestTimestamp());
      expect(await priceFeed.latestAnswer()).to.equal(newValue);
    });

    it("Should revert if msg.sender hasn't BIG_TIMELOCK_ADMIN", async function () {
      await expect(PriceFeedUpdaterTestService.connect(lender).updatePriceFeed(priceFeed.address, 0)).to.be.revertedWith(
        `AccessControl: account ${lender.address.toLowerCase()} is missing role ${DEFAULT_UPDATER_ROLE}`,
      );
    });
    it("Should revert when new set answer is 0", async function () {
      await expect(PriceFeedUpdaterTestService.updatePriceFeed(priceFeed.address, 0)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "AMOUNT_IS_0",
      );
    });
    it("Should revert when price feed address is zero address", async function () {
      await expect(PriceFeedUpdaterTestService.updatePriceFeed(AddressZero, 5)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
  });

  describe("checkPriceFeed", function () {
    it("should checkPriceFeed and return correct price feed status", async function () {
      const PriceFeedStatus = await PriceFeedUpdaterTestService.callStatic.checkPriceFeed([
        testTokenA.address,
        testTokenB.address,
        priceFeed.address,
      ]);
      expect(PriceFeedStatus.isNeedUpdate).to.equal(true);
      expect(PriceFeedStatus.priceFeed).to.equal(priceFeed.address);
      expect(PriceFeedStatus.lastAverageDexPrice).to.equal(await averageDexPrice(testTokenA, testTokenB, divider));
    });

    it("Should revert when one of addresses is 0", async function () {
      await expect(
        PriceFeedUpdaterTestService.checkPriceFeed({ token0: AddressZero, token1: testTokenB.address, priceFeed: priceFeed.address }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      await expect(
        PriceFeedUpdaterTestService.checkPriceFeed({ token0: testTokenA.address, token1: AddressZero, priceFeed: priceFeed.address }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      await expect(
        PriceFeedUpdaterTestService.checkPriceFeed({ token0: testTokenA.address, token1: testTokenB.address, priceFeed: AddressZero }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert when denominator is 0", async function () {
      await expect(
        PriceFeedUpdaterTestService.checkPriceFeed({ token0: testTokenA.address, token1: lender.address, priceFeed: priceFeed.address }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DENOMINATOR_IS_0");
    });
  });
});
