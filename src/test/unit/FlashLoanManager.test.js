// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  upgrades,
  ethers: {
    getContract,
    getContractFactory,
    getNamedSigners,
    utils: { parseUnits },
  },
  deployments: { fixture },
} = require("hardhat");
const { getAdminSigners } = require("../utils/hardhatUtils");

const { deployMockAccessControl, deployMockPrimexDNS, deployMockWhiteBlackList } = require("../utils/waffleMocks");

process.env.TEST = true;

describe("FlashLoanManager_unit", function () {
  let flashLoanManager, primexDNS, registry, tokenTransfersLibrary;
  let flashLoanFeeRate, flashLoanProtocolRate;
  let deployer, caller;
  let BigTimelockAdmin, SmallTimelockAdmin;
  let mockRegistry, mockPrimexDns, mockWhiteBlackList;

  let ErrorsLibrary;
  before(async function () {
    await fixture(["Test"]);
    ({ deployer, caller } = await getNamedSigners());
    flashLoanManager = await getContract("FlashLoanManager");
    primexDNS = await getContract("PrimexDNS");
    registry = await getContract("Registry");
    tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
    ErrorsLibrary = await getContract("Errors");
    ({ BigTimelockAdmin, SmallTimelockAdmin } = await getAdminSigners());

    mockRegistry = await deployMockAccessControl(deployer);
    mockPrimexDns = await deployMockPrimexDNS(deployer);
    mockWhiteBlackList = await deployMockWhiteBlackList(deployer);

    flashLoanFeeRate = parseUnits("5", 16);
    flashLoanProtocolRate = parseUnits("10", 16);
  });

  describe("initialize", function () {
    let snapshotId, FlashLoanManagerFactory, args, deployFLM;
    before(async function () {
      FlashLoanManagerFactory = await getContractFactory("FlashLoanManager", {
        libraries: {
          TokenTransfersLibrary: tokenTransfersLibrary.address,
        },
      });

      deployFLM = async function deployFLM(args) {
        return await upgrades.deployProxy(FlashLoanManagerFactory, [...args], {
          unsafeAllow: ["constructor", "delegatecall", "external-library-linking"],
        });
      };

      // to hide OZ warnings: You are using the "unsafeAllow.external-library-linking" flag to include external libraries.
      await upgrades.silenceWarnings();
    });

    beforeEach(async function () {
      args = [registry.address, primexDNS.address, mockWhiteBlackList.address, flashLoanFeeRate, flashLoanProtocolRate];
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
      const flashLoanManager = await deployFLM(args);
      expect(await flashLoanManager.registry()).to.be.equal(registry.address);
      expect(await flashLoanManager.primexDNS()).to.be.equal(primexDNS.address);
      expect(await flashLoanManager.whiteBlackList()).to.be.equal(mockWhiteBlackList.address);
    });

    it("Should revert deploy when registry address not supported", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      args[0] = mockRegistry.address;
      await expect(deployFLM(args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert deploy when dns address not supported", async function () {
      await mockPrimexDns.mock.supportsInterface.returns(false);
      args[1] = mockPrimexDns.address;
      await expect(deployFLM(args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert deploy when WhiteBlackList address not supported", async function () {
      await mockWhiteBlackList.mock.supportsInterface.returns(false);
      args[2] = mockWhiteBlackList.address;
      await expect(deployFLM(args)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert deploy when flashLoanFeeRate > 10%", async function () {
      args[3] = parseUnits("11", 16);
      await expect(deployFLM(args)).to.be.revertedWithCustomError(ErrorsLibrary, "FLASH_LOAN_FEE_RATE_IS_MORE_10_PERCENT");
    });
    it("Should revert deploy when flashLoanProtocolRate > 50%", async function () {
      args[4] = parseUnits("51", 17);
      await expect(deployFLM(args)).to.be.revertedWithCustomError(ErrorsLibrary, "FLASH_LOAN_PROTOCOL_RATE_IS_MORE_50_PERCENT");
    });
  });
  describe("setFlashLoanRates", function () {
    it("Should setFlashLoanRates and emit event", async function () {
      const newFlashLoanFeeRate = parseUnits("9", 16);
      const newFlashLoanProtocolRate = parseUnits("40", 16);
      await expect(flashLoanManager.connect(BigTimelockAdmin).setFlashLoanRates(newFlashLoanFeeRate, newFlashLoanProtocolRate))
        .to.emit(flashLoanManager, "ChangedFlashLoanRates")
        .withArgs(newFlashLoanFeeRate, newFlashLoanProtocolRate);

      expect(await flashLoanManager.flashLoanFeeRate()).to.be.equal(newFlashLoanFeeRate);
      expect(await flashLoanManager.flashLoanProtocolRate()).to.be.equal(newFlashLoanProtocolRate);
    });
    it("Should revert if not BigTimelockAdmin call setFlashLoanRates", async function () {
      const newFlashLoanFeeRate = parseUnits("9", 16);
      const newFlashLoanProtocolRate = parseUnits("40", 16);
      await expect(
        flashLoanManager.connect(SmallTimelockAdmin).setFlashLoanRates(newFlashLoanFeeRate, newFlashLoanProtocolRate),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert setFlashLoanRates when flashLoanFeeRate > 10%", async function () {
      const newFlashLoanFeeRate = parseUnits("11", 16);
      const newFlashLoanProtocolRate = parseUnits("40", 16);
      await expect(
        flashLoanManager.connect(BigTimelockAdmin).setFlashLoanRates(newFlashLoanFeeRate, newFlashLoanProtocolRate),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FLASH_LOAN_FEE_RATE_IS_MORE_10_PERCENT");
    });
    it("Should revert setFlashLoanRates when flashLoanProtocolRate > 50%", async function () {
      const newFlashLoanFeeRate = parseUnits("9", 16);
      const newFlashLoanProtocolRate = parseUnits("51", 16);
      await expect(
        flashLoanManager.connect(BigTimelockAdmin).setFlashLoanRates(newFlashLoanFeeRate, newFlashLoanProtocolRate),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FLASH_LOAN_PROTOCOL_RATE_IS_MORE_50_PERCENT");
    });
  });

  describe("pause & unpause", function () {
    it("Should revert if not EMERGENCY_ADMIN call pause", async function () {
      await expect(flashLoanManager.connect(caller).pause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await expect(flashLoanManager.connect(caller).unpause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
});
