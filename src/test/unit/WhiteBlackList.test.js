// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: { getContractFactory, getContract, getSigners },
  deployments: { fixture },
  upgrades,
} = require("hardhat");
const { deployMockAccessControlUpgradeable, deployMockERC20 } = require("../utils/waffleMocks");

process.env.TEST = true;

describe("WhiteBlackList_unit", function () {
  let WhiteBlackList, WhiteBlackListContract, mockAccessControlUpgradeable, mockContract;
  let deployer;
  let snapshotId;
  let ErrorsLibrary;

  before(async function () {
    await fixture(["Test"]);
    [deployer] = await getSigners();
    mockAccessControlUpgradeable = await deployMockAccessControlUpgradeable(deployer);

    WhiteBlackList = await getContractFactory("WhiteBlackList");
    WhiteBlackListContract = await upgrades.deployProxy(WhiteBlackList, [mockAccessControlUpgradeable.address], {
      unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
    });
    await WhiteBlackListContract.deployed();

    mockContract = await deployMockERC20(deployer);
    ErrorsLibrary = await getContract("Errors");
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

  describe("WhiteBlackList", function () {
    describe("initialize", function () {
      it("Should revert deploy if param 'address _registry' does not support IAccessControlUpgradeable", async function () {
        await mockAccessControlUpgradeable.mock.supportsInterface.returns(false);

        await expect(
          upgrades.deployProxy(WhiteBlackList, [mockAccessControlUpgradeable.address], {
            unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
          }),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      });
    });

    describe("addAddressToBlacklist", function () {
      it("Should revert if msg.sender is not granted with a BIG_TIMELOCK_ADMIN", async function () {
        await mockAccessControlUpgradeable.mock.hasRole.returns(false);

        await expect(WhiteBlackListContract.addAddressToBlacklist(mockContract.address)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "FORBIDDEN",
        );
      });

      it("Should revert if a param 'address _address' is already BLACKLISTED", async function () {
        expect(WhiteBlackListContract.addAddressToBlacklist(mockContract.address));

        await expect(WhiteBlackListContract.addAddressToBlacklist(mockContract.address)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ADDRESS_ALREADY_BLACKLISTED",
        );
      });
      it("Should revert if a param 'address _address' is already WHITELISTED", async function () {
        expect(WhiteBlackListContract.addAddressToWhitelist(mockContract.address));
        await expect(WhiteBlackListContract.addAddressToBlacklist(mockContract.address)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ADDRESS_IS_WHITELISTED",
        );
      });

      it("Should emit BlacklistedAddressAdded when a param 'address _address' is added to the black list", async function () {
        await expect(WhiteBlackListContract.addAddressToBlacklist(mockContract.address))
          .to.emit(WhiteBlackListContract, "BlacklistedAddressAdded")
          .withArgs(mockContract.address);
      });
    });
    describe("addAddressToWhitelist", function () {
      it("Should emit WhitelistedAddressAdded when a param 'address _address' is added to the black list", async function () {
        expect(WhiteBlackListContract.addAddressToBlacklist(mockContract.address));
        await expect(WhiteBlackListContract.addAddressToWhitelist(mockContract.address))
          .to.emit(WhiteBlackListContract, "WhitelistedAddressAdded")
          .withArgs(mockContract.address);
      });
    });
  });
});
