// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: {
    getContract,
    getContractAt,
    getNamedSigners,
    utils: { parseUnits },
    getContractFactory,
    constants: { AddressZero },
  },
  deployments: { fixture },
} = require("hardhat");
const { rayDiv } = require("./utils/math");
const { BigNumber } = require("bignumber.js");
const { deployMockBucket, deployBonusExecutor, deployMockBucketsFactory } = require("./utils/waffleMocks");
const { getAdminSigners, getImpersonateSigner } = require("./utils/hardhatUtils");
const { RAY } = require("./utils/constants");
const { addressFromEvent } = require("./utils/addressFromEvent");

process.env.TEST = true;

describe("DebtToken", function () {
  let debtTestTokenA, bucket, deployer, trader;
  let PrimexDNS;
  let mockBucket, mockExecutor;
  let decimalsDebtTestTokenA, registry;
  let ErrorsLibrary;
  let BigTimelockAdmin, mockBucketsFactorySigner, mockBucketsFactory;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader } = await getNamedSigners());
    ({ BigTimelockAdmin } = await getAdminSigners());
    registry = await getContract("Registry");
    mockBucketsFactory = await deployMockBucketsFactory(deployer);
    mockBucketsFactorySigner = await getImpersonateSigner(mockBucketsFactory);
    PrimexDNS = await getContract("PrimexDNS");
    ErrorsLibrary = await getContract("Errors");
    const bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    const debtTokenAddress = await bucket.debtToken();
    debtTestTokenA = await getContractAt("DebtToken", debtTokenAddress);
    decimalsDebtTestTokenA = await debtTestTokenA.decimals();
    mockBucket = await deployMockBucket(deployer);
    mockExecutor = await deployBonusExecutor(deployer);
  });

  describe("initialization", function () {
    it("Should initialize with correct values.", async function () {
      const underlyingAsset = await bucket.borrowedAsset();
      const decimalsOfUnderlyingAsset = await (await getContractAt("ERC20", underlyingAsset)).decimals();
      expect(await debtTestTokenA.name()).to.equal("Primex DebtToken TestTokenA");
      expect(await debtTestTokenA.symbol()).to.equal("debt-TTA");
      expect(decimalsDebtTestTokenA).to.equal(decimalsOfUnderlyingAsset);
    });
  });
  describe("Transfers and allowances", function () {
    it("Should revert when the increaseAllowance func is called", async function () {
      await expect(debtTestTokenA.increaseAllowance(trader.address, parseUnits("1", decimalsDebtTestTokenA))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "APPROVE_NOT_SUPPORTED",
      );
    });
    it("Should revert when the decreaseAllowance func is called", async function () {
      await expect(debtTestTokenA.decreaseAllowance(trader.address, parseUnits("1", decimalsDebtTestTokenA))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "APPROVE_NOT_SUPPORTED",
      );
    });
  });
  describe("SetBucket", function () {
    it("Should revert when bucket already set", async function () {
      const debtTokensFactory = await getContract("DebtTokensFactory");
      const bucketsFactory = await debtTokensFactory.bucketsFactory();
      const bucketsFactorySigner = await getImpersonateSigner(await getContractAt("BucketsFactory", bucketsFactory));
      await expect(debtTestTokenA.connect(bucketsFactorySigner).setBucket(bucket.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BUCKET_IS_IMMUTABLE",
      );
    });
    it("Should revert if not the bucket factory call setBucket", async function () {
      const debtTokensFactoryFactory = await getContractFactory("DebtTokensFactory");
      const debtTokenImplementation = await getContract("DebtToken");
      const debtTokensFactory = await debtTokensFactoryFactory.deploy(debtTokenImplementation.address, registry.address);
      await debtTokensFactory.deployed();
      await debtTokensFactory.setBucketsFactory(mockBucketsFactory.address);
      const tx = await debtTokensFactory.connect(mockBucketsFactorySigner).createDebtToken("DToken", "DT", "18");
      const txReceipt = await tx.wait();
      const debtTokenAddress = addressFromEvent("DebtTokenCreated", txReceipt);
      const debtToken = await getContractAt("DebtToken", debtTokenAddress);
      await expect(debtToken.setBucket(mockBucket.address)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert when a param 'IBucket _bucket' does not support IBucket", async function () {
      await mockBucket.mock.supportsInterface.returns(false);

      const debtTokensFactoryFactory = await getContractFactory("DebtTokensFactory");
      const debtTokenImplementation = await getContract("DebtToken");
      const debtTokensFactory = await debtTokensFactoryFactory.deploy(debtTokenImplementation.address, registry.address);
      await debtTokensFactory.deployed();
      await debtTokensFactory.setBucketsFactory(mockBucketsFactory.address);
      const tx = await debtTokensFactory.connect(mockBucketsFactorySigner).createDebtToken("DToken", "DT", "18");
      const txReceipt = await tx.wait();
      const debtTokenAddress = addressFromEvent("DebtTokenCreated", txReceipt);
      const debtToken = await getContractAt("DebtToken", debtTokenAddress);

      await expect(debtToken.connect(mockBucketsFactorySigner).setBucket(mockBucket.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
  });
  describe("setFeeDecreaser", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setFeeDecreaser", async function () {
      await expect(debtTestTokenA.connect(trader).setFeeDecreaser(bucket.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert when the address does not support IBonusExecutor", async function () {
      await expect(debtTestTokenA.setFeeDecreaser(bucket.address)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should set the FeeDecreaser", async function () {
      await mockExecutor.mock.supportsInterface.returns(true);
      await debtTestTokenA.connect(BigTimelockAdmin).setFeeDecreaser(mockExecutor.address);
      expect(await debtTestTokenA.feeDecreaser()).to.be.equal(mockExecutor.address);
    });
    it("Should set zero address", async function () {
      await debtTestTokenA.setFeeDecreaser(AddressZero);
      expect(await debtTestTokenA.feeDecreaser()).to.be.equal(AddressZero);
    });
  });

  describe("setTraderRewardDistributor", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setTraderRewardDistributor", async function () {
      const newTraderRewardDitributor = trader.address;
      await expect(debtTestTokenA.connect(trader).setTraderRewardDistributor(newTraderRewardDitributor)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert when the address does not support IBonusExecutor", async function () {
      await expect(debtTestTokenA.setTraderRewardDistributor(bucket.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );
    });
    it("Should set the TraderRewardDitributor", async function () {
      const newTraderRewardDitributor = mockExecutor.address;
      await mockExecutor.mock.supportsInterface.returns(true);
      await debtTestTokenA.connect(BigTimelockAdmin).setTraderRewardDistributor(newTraderRewardDitributor);
      expect(await debtTestTokenA.traderRewardDistributor()).to.be.equal(newTraderRewardDitributor);
    });
    it("Should set zero address", async function () {
      await debtTestTokenA.setTraderRewardDistributor(AddressZero);
      expect(await debtTestTokenA.traderRewardDistributor()).to.be.equal(AddressZero);
    });
  });
  describe("Not supported", function () {
    it("Should revert when transfer", async function () {
      await expect(debtTestTokenA.transfer(trader.address, "100")).to.be.revertedWithCustomError(ErrorsLibrary, "TRANSFER_NOT_SUPPORTED");
    });
    it("Should revert when approve", async function () {
      await expect(debtTestTokenA.approve(trader.address, "100")).to.be.revertedWithCustomError(ErrorsLibrary, "APPROVE_NOT_SUPPORTED");
    });
    it("Should revert when transferFrom", async function () {
      await expect(debtTestTokenA.transferFrom(trader.address, trader.address, "100")).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "TRANSFER_NOT_SUPPORTED",
      );
    });
    it("Should revert when increaseAllowance", async function () {
      await expect(debtTestTokenA.increaseAllowance(trader.address, "100")).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "APPROVE_NOT_SUPPORTED",
      );
    });
    it("Should revert when decreaseAllowance", async function () {
      await expect(debtTestTokenA.decreaseAllowance(trader.address, "100")).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "APPROVE_NOT_SUPPORTED",
      );
    });
  });
  describe("Access", function () {
    it("Should revert mint when caller is not bucket", async function () {
      await expect(
        debtTestTokenA.mint(trader.address, parseUnits("1", decimalsDebtTestTokenA), RAY.toString()),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CALLER_IS_NOT_BUCKET");
    });
    it("Should revert burn when caller is not bucket", async function () {
      await expect(
        debtTestTokenA.burn(trader.address, parseUnits("1", decimalsDebtTestTokenA), RAY.toString()),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CALLER_IS_NOT_BUCKET");
    });
  });
  describe("Mint & Burn", function () {
    let debtToken, bucketMock;
    before(async function () {
      const debtTokensFactoryFactory = await getContractFactory("DebtTokensFactory");
      const debtTokenImplementation = await getContract("DebtToken");
      const debtTokensFactory = await debtTokensFactoryFactory.deploy(debtTokenImplementation.address, registry.address);
      await debtTokensFactory.deployed();
      await debtTokensFactory.setBucketsFactory(mockBucketsFactory.address);
      const tx = await debtTokensFactory.connect(mockBucketsFactorySigner).createDebtToken("DToken", "DT", "18");
      const txReceipt = await tx.wait();
      const debtTokenAddress = addressFromEvent("DebtTokenCreated", txReceipt);
      debtToken = await getContractAt("DebtToken", debtTokenAddress);

      const bucketMockFactory = await getContractFactory("BucketMock");
      bucketMock = await bucketMockFactory.deploy();
      await bucketMock.deployed();

      await debtToken.connect(mockBucketsFactorySigner).setBucket(bucketMock.address);
      await bucketMock.setDebtToken(debtToken.address);
    });

    let snapshotId;
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    afterEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });

    it("Should Mint", async function () {
      const traderDebtTokenBalance = await debtToken.balanceOf(trader.address);
      const amountToMint = parseUnits("1", decimalsDebtTestTokenA);
      const variableBorrowIndex = await bucketMock.variableBorrowIndex();
      await bucketMock.mintDebtToken(trader.address, amountToMint, variableBorrowIndex);
      const result = traderDebtTokenBalance.add(rayDiv(amountToMint.toString(), variableBorrowIndex.toString()).toString());
      expect(await debtToken.scaledBalanceOf(trader.address)).to.be.equal(result);
    });

    it("Should revert mint when a param 'address _user' is zero", async function () {
      await expect(
        bucketMock.mintDebtToken(AddressZero, parseUnits("1", decimalsDebtTestTokenA), RAY.toString()),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert mint when amount is 0", async function () {
      await expect(bucketMock.mintDebtToken(trader.address, 0, RAY.toString())).to.be.revertedWithCustomError(ErrorsLibrary, "AMOUNT_IS_0");
    });

    it("Should revert mint when invalid mint amount", async function () {
      const variableBorrowIndex = new BigNumber(10).exponentiatedBy(28).toFixed();
      await bucketMock.setVariableBorrowIndex(variableBorrowIndex);
      await expect(bucketMock.mintDebtToken(trader.address, 1, variableBorrowIndex)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INVALID_MINT_AMOUNT",
      );
    });

    it("Should Burn", async function () {
      const traderDebtTokenBalance = await debtToken.balanceOf(trader.address);
      const amountToMint = parseUnits("1", decimalsDebtTestTokenA);
      const variableBorrowIndex = await bucketMock.variableBorrowIndex();
      await bucketMock.mintDebtToken(trader.address, amountToMint, variableBorrowIndex);
      const result = traderDebtTokenBalance.add(rayDiv(amountToMint.toString(), variableBorrowIndex.toString()).toString());
      expect(await debtToken.scaledBalanceOf(trader.address)).to.be.equal(result);
      await bucketMock.burnDebtToken(trader.address, amountToMint, variableBorrowIndex);
      expect(await debtToken.scaledBalanceOf(trader.address)).to.be.equal(traderDebtTokenBalance);
    });

    it("Should revert Burn when a param 'address _user' is zero", async function () {
      await expect(
        bucketMock.burnDebtToken(AddressZero, parseUnits("1", decimalsDebtTestTokenA), RAY.toString()),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert Burn when amount is 0", async function () {
      await expect(bucketMock.burnDebtToken(trader.address, 0, RAY.toString())).to.be.revertedWithCustomError(ErrorsLibrary, "AMOUNT_IS_0");
    });

    it("Should revert Burn when invalid mint amount", async function () {
      const variableBorrowIndex = new BigNumber(10).exponentiatedBy(28).toFixed();
      await bucketMock.setVariableBorrowIndex(variableBorrowIndex);
      await expect(bucketMock.burnDebtToken(trader.address, 1, variableBorrowIndex)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INVALID_BURN_AMOUNT",
      );
    });
  });
});
