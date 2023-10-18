// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  ethers: { provider, getContract, getNamedSigners, getContractFactory },
  deployments: { fixture },
} = require("hardhat");
const { getAdminSigners } = require("../utils/hardhatUtils");
const { USD_DECIMALS } = require("../utils/constants");
const { parseArguments } = require("../utils/eventValidation");

process.env.TEST = true;

describe("EPMXPriceFeed_unit", function () {
  let EPMXPriceFeed, registry, errors;
  let trader, BigTimelockAdmin;
  beforeEach(async function () {
    await fixture(["Test"]);
    EPMXPriceFeed = await getContract("EPMXPriceFeed");
    registry = await getContract("Registry");
    errors = await getContract("Errors");

    ({ trader } = await getNamedSigners());
    ({ BigTimelockAdmin } = await getAdminSigners());
  });
  describe("constructor", function () {
    it("Should set var", async function () {
      expect(await EPMXPriceFeed.registry()).to.equal(registry.address);
      expect(await EPMXPriceFeed.description()).to.equal("EPMX / USD");
      expect(await EPMXPriceFeed.decimals()).to.equal(USD_DECIMALS);
    });
    it("Should revert deploy if address not supported", async function () {
      const factory = await getContractFactory("EPMXPriceFeed");
      const AccessControlNotSuported = await getContract("PositionManager");
      await expect(factory.deploy(AccessControlNotSuported.address)).to.be.revertedWithCustomError(errors, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("setAnswer", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setAnswer", async function () {
      await expect(EPMXPriceFeed.connect(trader).setAnswer(1)).to.be.revertedWithCustomError(errors, "FORBIDDEN");
    });
    it("Should update values", async function () {
      const value = 1;
      const previosRoundId = await EPMXPriceFeed.latestRound();
      const newRoundId = previosRoundId.add(1);
      await EPMXPriceFeed.connect(BigTimelockAdmin).setAnswer(value);
      const timestamp = (await provider.getBlock("latest")).timestamp;

      const latestRoundData = [newRoundId, value, timestamp, timestamp, newRoundId];

      expect(await EPMXPriceFeed.latestAnswer()).to.equal(value);
      expect(await EPMXPriceFeed.latestRound()).to.equal(newRoundId);
      expect(await EPMXPriceFeed.getTimestamp(newRoundId)).to.equal(timestamp);
      expect(await EPMXPriceFeed.getAnswer(newRoundId)).to.equal(value);
      expect(await EPMXPriceFeed.latestTimestamp()).to.equal(timestamp);

      parseArguments(await EPMXPriceFeed.getRoundData(newRoundId), latestRoundData);
      parseArguments(await EPMXPriceFeed.latestRoundData(), latestRoundData);
    });
  });
});
