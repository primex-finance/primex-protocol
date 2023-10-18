// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  ethers: {
    getContract,
    utils: { toUtf8Bytes, keccak256 },
    getNamedSigners,
  },
  deployments: { fixture },
} = require("hardhat");

process.env.TEST = true;

const DEFAULT_UPDATER_ROLE = keccak256(toUtf8Bytes("DEFAULT_UPDATER_ROLE"));

describe("PriceFeedsAccessControl", function () {
  let priceFeed, trader, deployer;

  beforeEach(async function () {
    await fixture(["Test"]);
    priceFeed = await getContract("PrimexAggregatorV3TestService TEST price feed");
    ({ deployer, trader } = await getNamedSigners());
  });

  describe("setAnswer", function () {
    it("Should revert if call account not DEFAULT_UPDATER_ROLE", async function () {
      expect(await priceFeed.hasRole(DEFAULT_UPDATER_ROLE, trader.address)).to.equal(false);
      await expect(priceFeed.connect(trader).setAnswer(1)).to.be.revertedWith(
        `AccessControl: account ${trader.address.toLowerCase()} is missing role ${DEFAULT_UPDATER_ROLE}`,
      );
    });
    it("Should update value if call account with DEFAULT_UPDATER_ROLE", async function () {
      const value = 1;
      expect(await priceFeed.hasRole(DEFAULT_UPDATER_ROLE, deployer.address)).to.equal(true);
      await priceFeed.setAnswer(value);
      expect(await priceFeed.latestAnswer()).to.equal(value);
      expect((await priceFeed.latestRoundData())[1]).to.equal(value);
    });
  });
  describe("setDecimals", function () {
    it("Should revert if call account not DEFAULT_UPDATER_ROLE", async function () {
      expect(await priceFeed.hasRole(DEFAULT_UPDATER_ROLE, trader.address)).to.equal(false);
      await expect(priceFeed.connect(trader).setDecimals(1)).to.be.revertedWith(
        `AccessControl: account ${trader.address.toLowerCase()} is missing role ${DEFAULT_UPDATER_ROLE}`,
      );
    });
    it("Should update value if call account with DEFAULT_UPDATER_ROLE", async function () {
      const value = 1;
      expect(await priceFeed.hasRole(DEFAULT_UPDATER_ROLE, deployer.address)).to.equal(true);
      await priceFeed.setDecimals(value);
      expect(await priceFeed.decimals()).to.equal(value);
    });
  });
});
