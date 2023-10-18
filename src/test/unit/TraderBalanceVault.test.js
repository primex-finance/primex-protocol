// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  upgrades,
  ethers: {
    getSigners,
    getContractFactory,
    getContract,
    utils: { parseEther },
    constants: { AddressZero },
  },
  deployments: { fixture },
} = require("hardhat");
const { deployMockAccessControl, deployMockERC20, deployMockWhiteBlackList } = require("../utils/waffleMocks");
const { NATIVE_CURRENCY } = require("../utils/constants");

process.env.TEST = true;

describe("TraderBalanceVault_unit", function () {
  let traderBalanceVaultFactory, traderBalanceVault;
  let deployer, trader, receiver;
  let mockRegistry, mockWhiteBlackList, mockTokenTransfersLibrary, mockErc20;
  let amount;
  let ErrorsLibrary;

  before(async function () {
    await fixture(["Test"]);
    [deployer, trader, receiver] = await getSigners();
    ErrorsLibrary = await getContract("Errors");
    mockWhiteBlackList = await deployMockWhiteBlackList(deployer);
    const mockTokenTransfersLibraryFactory = await getContractFactory("TokenTransfersLibraryMock");
    mockTokenTransfersLibrary = await mockTokenTransfersLibraryFactory.deploy();

    // to hide OZ warnings
    await upgrades.silenceWarnings();
    traderBalanceVaultFactory = await getContractFactory("TraderBalanceVault", {
      libraries: { TokenTransfersLibrary: mockTokenTransfersLibrary.address },
    });

    mockErc20 = await deployMockERC20(deployer);
  });

  beforeEach(async function () {
    amount = parseEther("1");
    mockRegistry = await deployMockAccessControl(deployer);
    traderBalanceVault = await upgrades.deployProxy(traderBalanceVaultFactory, [mockRegistry.address, mockWhiteBlackList.address], {
      unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
    });
    await mockErc20.mock.decimals.returns(18);
    await mockWhiteBlackList.mock.isBlackListed.returns(false);
  });

  describe("initialize", function () {
    it("Should deploy 'TraderBalanceVault' contract with correct registry address", async function () {
      const registry = await traderBalanceVault.registry();

      expect(registry).to.equal(mockRegistry.address);
    });

    it("Should revert deploy if registry address does not support 'IAccessControl' interface", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);

      await expect(
        upgrades.deployProxy(traderBalanceVaultFactory, [mockRegistry.address, mockWhiteBlackList.address], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("deposit()", function () {
    it("Should revert when the traderBalanceVault is paused", async function () {
      await traderBalanceVault.pause();
      await expect(traderBalanceVault.deposit(mockErc20.address, amount)).to.be.revertedWith("Pausable: paused");
    });
    it("Should revert when the msg.sender is on the blacklist", async function () {
      await mockWhiteBlackList.mock.isBlackListed.returns(true);
      await expect(traderBalanceVault.deposit(mockErc20.address, amount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SENDER_IS_BLACKLISTED",
      );
    });

    it("Should revert when a param 'uint256 _amount' is 0", async function () {
      amount = 0;
      await expect(traderBalanceVault.deposit(mockErc20.address, amount)).to.be.revertedWithCustomError(ErrorsLibrary, "AMOUNT_IS_0");
    });

    it("Should revert when deposit asset returns incorrect decimals", async function () {
      await mockErc20.mock.decimals.returns(19);
      await expect(traderBalanceVault.deposit(mockErc20.address, amount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ASSET_DECIMALS_EXCEEDS_MAX_VALUE",
      );
    });

    it("Should revert when an asset is native currency and the msg.value amount is zero", async function () {
      amount = 0;
      await expect(traderBalanceVault.deposit(NATIVE_CURRENCY, amount, { value: 0 })).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "AMOUNT_IS_0",
      );
    });
    it("Should revert when an asset is native currency and the msg.value > 0, but an amount > 0 too", async function () {
      amount = 10;
      await expect(traderBalanceVault.deposit(NATIVE_CURRENCY, amount, { value: 100 })).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "AMOUNT_IS_0",
      );
    });
    it("Should revert when an asset is erc-20 token, amount > 0, but the msg.value > 0 too", async function () {
      amount = 10;
      await expect(traderBalanceVault.deposit(mockErc20.address, amount, { value: 100 })).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "AMOUNT_IS_0",
      );
    });
    it("Should emit Deposit event if an asset is native currency and deposit is successful", async function () {
      amount = 0;
      await expect(traderBalanceVault.deposit(NATIVE_CURRENCY, amount, { value: 100 })).to.emit(traderBalanceVault, "Deposit");
    });
    it("Should emit Deposit event when deposit was called via the receive function", async function () {
      await expect(
        deployer.sendTransaction({
          to: traderBalanceVault.address,
          data: "0x",
          value: 100,
        }),
      ).to.emit(traderBalanceVault, "Deposit");
    });
    it("Should emit Deposit event if deposit is successful", async function () {
      await expect(traderBalanceVault.connect(deployer).deposit(mockErc20.address, amount))
        .to.emit(traderBalanceVault, "Deposit")
        .withArgs(deployer.address, mockErc20.address, amount);
    });
  });

  describe("withdraw()", function () {
    it("Should revert when the msg.sender is on the blacklist", async function () {
      await mockWhiteBlackList.mock.isBlackListed.returns(true);
      await expect(traderBalanceVault.withdraw(mockErc20.address, amount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SENDER_IS_BLACKLISTED",
      );
    });
    it("Should revert when a param 'uint256 _amount' is 0", async function () {
      amount = 0;
      await expect(traderBalanceVault.withdraw(mockErc20.address, amount)).to.be.revertedWithCustomError(ErrorsLibrary, "AMOUNT_IS_0");
    });

    it("Should revert when amount to withdraw exceeds balance", async function () {
      await expect(traderBalanceVault.withdraw(mockErc20.address, amount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INSUFFICIENT_FREE_ASSETS",
      );
    });

    it("Should emit Withdraw event if withdraw is successful", async function () {
      await traderBalanceVault.deposit(mockErc20.address, parseEther("10"));

      await expect(traderBalanceVault.withdraw(mockErc20.address, amount)).to.emit(traderBalanceVault, "Withdraw");
    });
    it("Should emit Withdraw event if an asset is native currency and withdraw is successful", async function () {
      await traderBalanceVault.deposit(NATIVE_CURRENCY, 0, { value: parseEther("1") });
      await expect(traderBalanceVault.withdraw(NATIVE_CURRENCY, amount)).to.emit(traderBalanceVault, "Withdraw");
    });
  });

  describe("topUpAvailableBalance() & batchTopUpAvailableBalance()", function () {
    it("Should revert when a msg.sender is not granted with VAULT_ACCESS_ROLE", async function () {
      mockRegistry = await deployMockAccessControl(deployer);
      await mockRegistry.mock.hasRole.returns(false);
      traderBalanceVault = await upgrades.deployProxy(traderBalanceVaultFactory, [mockRegistry.address, mockWhiteBlackList.address], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });

      await expect(traderBalanceVault.topUpAvailableBalance(trader.address, mockErc20.address, amount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert topUpAvailableBalance when amount is more than msg.value", async function () {
      await mockRegistry.mock.hasRole.returns(true);
      await expect(traderBalanceVault.topUpAvailableBalance(trader.address, NATIVE_CURRENCY, amount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INVALID_AMOUNT",
      );
    });
    it("Should topUpAvailableBalance when amount is equal to msg.value", async function () {
      await mockRegistry.mock.hasRole.returns(true);
      expect(await traderBalanceVault.topUpAvailableBalance(trader.address, NATIVE_CURRENCY, amount, { value: amount }));
    });
    it("Should revert batchTopUpAvailableBalance when trader the address or the asset is zero", async function () {
      await mockRegistry.mock.hasRole.returns(true);

      const BatchTopUpAvailableBalanceParams = {
        traders: [trader.address],
        amounts: [10],
        asset: mockErc20.address,
        length: 1,
      };
      BatchTopUpAvailableBalanceParams.traders = [AddressZero];
      await expect(traderBalanceVault.batchTopUpAvailableBalance(BatchTopUpAvailableBalanceParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
      BatchTopUpAvailableBalanceParams.asset = AddressZero;
      BatchTopUpAvailableBalanceParams.traders = [trader.address];
      await expect(traderBalanceVault.batchTopUpAvailableBalance(BatchTopUpAvailableBalanceParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
  });

  describe("increaseLockedBalance()", function () {
    it("Should revert when a msg.sender is not granted with VAULT_ACCESS_ROLE", async function () {
      mockRegistry = await deployMockAccessControl(deployer);
      await mockRegistry.mock.hasRole.returns(false);
      traderBalanceVault = await upgrades.deployProxy(traderBalanceVaultFactory, [mockRegistry.address, mockWhiteBlackList.address], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });

      await expect(traderBalanceVault.increaseLockedBalance(trader.address, mockErc20.address, amount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should revert when a param 'uint256 _amount' is 0", async function () {
      amount = 0;
      await expect(traderBalanceVault.increaseLockedBalance(trader.address, mockErc20.address, amount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "AMOUNT_IS_0",
      );
    });
    it("Should revert when deposit asset returns incorrect decimals", async function () {
      await mockErc20.mock.decimals.returns(19);
      await expect(traderBalanceVault.increaseLockedBalance(trader.address, mockErc20.address, amount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ASSET_DECIMALS_EXCEEDS_MAX_VALUE",
      );
    });

    it("Should emit Deposit event if deposit and lock is successful", async function () {
      await expect(traderBalanceVault.increaseLockedBalance(trader.address, mockErc20.address, amount)).to.emit(
        traderBalanceVault,
        "Deposit",
      );
    });
  });

  describe("useTraderAssets()", function () {
    const OPEN_BY_ORDER = 0;
    const OPEN = 1;
    const CREATE_LIMIT_ORDER = 2;
    let lockAssetParam;

    beforeEach(async function () {
      lockAssetParam = [
        {
          trader: trader.address,
          depositReceiver: receiver.address,
          borrowedAsset: mockErc20.address,
          depositAsset: mockErc20.address,
          depositAmount: parseEther("1"),
          depositInBorrowedAmount: parseEther("1"),
          openType: OPEN_BY_ORDER,
        },
      ];
    });

    it("Should revert when a msg.sender is not granted with VAULT_ACCESS_ROLE", async function () {
      mockRegistry = await deployMockAccessControl(deployer);
      await mockRegistry.mock.hasRole.returns(false);
      traderBalanceVault = await upgrades.deployProxy(traderBalanceVaultFactory, [mockRegistry.address, mockWhiteBlackList.address], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });

      await expect(traderBalanceVault.useTraderAssets(lockAssetParam[0])).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if OpenType is not OPEN_BY_ORDER and depositAmount exceeds availableBalance", async function () {
      lockAssetParam[0].depositAmount = parseEther("100000000000000000");
      lockAssetParam[0].openType = OPEN;
      await expect(traderBalanceVault.useTraderAssets(lockAssetParam[0])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INSUFFICIENT_FREE_ASSETS",
      );

      lockAssetParam[0].openType = CREATE_LIMIT_ORDER;
      await expect(traderBalanceVault.useTraderAssets(lockAssetParam[0])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INSUFFICIENT_FREE_ASSETS",
      );
    });
  });

  describe("unlockAsset()", function () {
    let unlockAssetParam;
    // eslint-disable-next-line mocha/no-hooks-for-single-case
    before(async function () {
      unlockAssetParam = [
        {
          trader: trader.address,
          receiver: receiver.address,
          asset: mockErc20.address,
          amount: parseEther("1"),
        },
      ];
    });

    it("Should revert when a msg.sender is not granted with VAULT_ACCESS_ROLE", async function () {
      mockRegistry = await deployMockAccessControl(deployer);
      await mockRegistry.mock.hasRole.returns(false);
      traderBalanceVault = await upgrades.deployProxy(traderBalanceVaultFactory, [mockRegistry.address, mockWhiteBlackList.address], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });

      await expect(traderBalanceVault.unlockAsset(unlockAssetParam[0])).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
  describe("pause & unpause", function () {
    it("Should revert if not EMERGENCY_ADMIN call pause", async function () {
      await mockRegistry.mock.hasRole.returns(false);
      await expect(traderBalanceVault.connect(trader).pause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await mockRegistry.mock.hasRole.returns(false);
      await expect(traderBalanceVault.connect(trader).unpause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
});
