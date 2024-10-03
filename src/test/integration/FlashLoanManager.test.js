// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    getContract,
    getNamedSigners,
    getContractAt,
    BigNumber,
    utils: { parseUnits, defaultAbiCoder },
    constants: { MaxUint256 },
  },
  deployments: { fixture },
} = require("hardhat");
const { deployMockERC20, deployMockBucket } = require("../utils/waffleMocks");
const { addLiquidity, checkIsDexSupported } = require("../utils/dexOperations");
const { eventValidation } = require("../utils/eventValidation");
const { wadMul, rayDiv, rayMul } = require("../../test/utils/math");
const { getImpersonateSigner } = require("../utils/hardhatUtils");
const { barCalcParams } = require("../utils/defaultBarCalcParams");
const { FLASH_LOAN_FREE_BORROWER_ROLE } = require("../../Constants");
const { RAY } = require("../utils/constants");
process.env.TEST = true;

function sortAddressesAndAmounts(addresses, amounts) {
  const sorted = addresses
    .map((address, index) => ({ address, amount: amounts[index] }))
    .sort((a, b) => {
      const addressA = BigNumber.from(a.address);
      const addressB = BigNumber.from(b.address);

      if (addressA.lt(addressB)) return -1;
      if (addressA.gt(addressB)) return 1;
      return 0;
    });

  return {
    sortedAddresses: sorted.map(item => item.address),
    sortedAmounts: sorted.map(item => item.amount),
  };
}

describe("FlashLoanManager_integration", function () {
  let dex, testTokenA, testTokenB;
  let Treasury, PrimexDNS, Registry, ErrorsLibrary;
  let WhiteBlackList, FlashLoanManager, mockContract;
  let deployer, trader, lender, flashLoanReceiver;
  let bucket, bucket2, bucketAddress, lenderAmount;
  let decimalsA, borrowedAmount, params;
  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, lender } = await getNamedSigners());
    ErrorsLibrary = await getContract("Errors");
    Treasury = await getContract("Treasury");
    PrimexDNS = await getContract("PrimexDNS");
    WhiteBlackList = await getContract("WhiteBlackList");
    Registry = await getContract("Registry");

    FlashLoanManager = await getContract("FlashLoanManager");
    flashLoanReceiver = await getContract("MockFlashLoanReceiver");

    mockContract = await deployMockERC20(deployer);
    mockContract = await getImpersonateSigner(mockContract);

    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    testTokenB = await getContract("TestTokenB");

    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    await testTokenA.mint(lender.address, parseUnits("200", decimalsA));
    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
    } else {
      dex = "uniswap";
    }
    checkIsDexSupported(dex);

    await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
    lenderAmount = parseUnits("100", decimalsA);

    bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);

    const bucketName2 = "bucket2";
    const assets = `["${testTokenB.address}"]`;
    const underlyingAsset = testTokenA.address;
    const feeBuffer = "1000200000000000000"; // 1.0002
    const withdrawalFeeRate = "5000000000000000"; // 0.005 - 0.5%
    const reserveRate = "100000000000000000"; // 0.1 - 10%
    const estimatedBar = "100000000000000000000000000"; // 0.1 in ray
    const estimatedLar = "70000000000000000000000000"; // 0.07 in ray

    // bucket 2
    const { newBucket: newBucketAddress } = await run("deploy:Bucket", {
      nameBucket: bucketName2,
      assets: assets,
      pairPriceDrops: "[\"100000000000000000\"]",
      feeBuffer: feeBuffer,
      withdrawalFeeRate: withdrawalFeeRate, // 0.005 - 0.5%
      reserveRate: reserveRate,
      underlyingAsset: underlyingAsset,
      liquidityMiningRewardDistributor: "0",
      liquidityMiningAmount: "0",
      liquidityMiningDeadline: "0",
      stabilizationDuration: "0",
      pmxRewardAmount: "0",
      estimatedBar: estimatedBar,
      estimatedLar: estimatedLar,
      maxAmountPerUser: MaxUint256.toString(),
      barCalcParams: JSON.stringify(barCalcParams),
      maxTotalDeposit: MaxUint256.toString(),
    });

    bucket2 = await getContractAt("Bucket", newBucketAddress);
    await testTokenA.connect(lender).approve(bucket2.address, MaxUint256);
    await bucket2.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);
    borrowedAmount = parseUnits("10", decimalsA);
    params = defaultAbiCoder.encode(["address"], [FlashLoanManager.address]);
  });

  describe("flashLoan", function () {
    let flashLoanParams, flashLoanFee, feeToTreasury, feeToBucket, flashLoanFeeRate;
    let snapshotId;
    before(async function () {
      flashLoanParams = [flashLoanReceiver.address, [bucket.address, bucket2.address], [borrowedAmount, borrowedAmount], params];
      const { sortedAddresses, sortedAmounts } = sortAddressesAndAmounts(flashLoanParams[1], flashLoanParams[2]);
      flashLoanParams[1] = sortedAddresses;
      flashLoanParams[2] = sortedAmounts;
      flashLoanFeeRate = await FlashLoanManager.flashLoanFeeRate();
      const flashLoanProtocolRate = await FlashLoanManager.flashLoanProtocolRate();
      flashLoanFee = wadMul(borrowedAmount.toString(), flashLoanFeeRate.toString()).toString();
      feeToTreasury = wadMul(flashLoanFee, flashLoanProtocolRate.toString()).toString();
      feeToBucket = BigNumber.from(flashLoanFee).sub(feeToTreasury);
      const amountToApprove = borrowedAmount.add(flashLoanFee).mul(2);
      await flashLoanReceiver.setAmountToApprove(amountToApprove);
      await testTokenA.mint(flashLoanReceiver.address, BigNumber.from(flashLoanFee).mul(2));
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

    it("Should revert if the flashLoanManager is paused", async function () {
      await FlashLoanManager.pause();
      await expect(FlashLoanManager.connect(trader).flashLoan(...flashLoanParams)).to.be.revertedWith("Pausable: paused");
    });

    it("Should revert if the msg.sender is on the blacklist", async function () {
      await WhiteBlackList.addAddressToBlacklist(mockContract.address);
      await expect(FlashLoanManager.connect(mockContract).flashLoan(...flashLoanParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SENDER_IS_BLACKLISTED",
      );
    });

    it("Should revert flashLoan if buckets length does not match amounts length", async function () {
      const additionalAmount = parseUnits("20", decimalsA);
      const flashLoanParamsWithExtraAmount = [
        flashLoanReceiver.address,
        [bucket.address, bucket2.address],
        [borrowedAmount, borrowedAmount, additionalAmount],
        params,
      ];

      await expect(FlashLoanManager.connect(trader).flashLoan(...flashLoanParamsWithExtraAmount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCONSISTENT_FLASHLOAN_PARAMS",
      );
    });

    it("Should revert flashLoan if buckets has duplicates", async function () {
      const flashLoanParams = [
        flashLoanReceiver.address,
        [bucket.address, bucket.address, bucket2.address],
        [borrowedAmount, borrowedAmount, borrowedAmount],
        params,
      ];
      await expect(FlashLoanManager.connect(trader).flashLoan(...flashLoanParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SHOULD_NOT_HAVE_DUPLICATES",
      );
    });
    it("Should revert flashLoan if bucket address is not added to primexDNS", async function () {
      const flashLoanParams = [flashLoanReceiver.address, [Treasury.address, bucket2.address], [borrowedAmount, borrowedAmount], params];
      await expect(FlashLoanManager.connect(trader).flashLoan(...flashLoanParams)).to.be.reverted;
    });
    it("Should revert flashLoan if bucket address is not added to primexDNS but bucketName is added", async function () {
      const mockBucket = await deployMockBucket(deployer);
      await mockBucket.mock.name.returns("bucket2");
      const buckets = [mockBucket.address, bucket.address, bucket2.address];
      buckets.sort((a, b) => {
        return BigNumber.from(a).sub(b).isNegative() ? -1 : 1;
      });

      const flashLoanParams = [flashLoanReceiver.address, buckets, [borrowedAmount, borrowedAmount, borrowedAmount], params];

      await expect(FlashLoanManager.connect(trader).flashLoan(...flashLoanParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BUCKET_OUTSIDE_PRIMEX_PROTOCOL",
      );
    });

    it("Should revert flashLoan if bucket is not active", async function () {
      const flashLoanParams = [flashLoanReceiver.address, [bucket.address, bucket2.address], [borrowedAmount, borrowedAmount], params];
      const { sortedAddresses, sortedAmounts } = sortAddressesAndAmounts(flashLoanParams[1], flashLoanParams[2]);
      flashLoanParams[1] = sortedAddresses;
      flashLoanParams[2] = sortedAmounts;
      await PrimexDNS.freezeBucket("bucket1");
      await expect(FlashLoanManager.connect(trader).flashLoan(...flashLoanParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BUCKET_IS_NOT_ACTIVE",
      );
    });
    it("Should revert flashLoan if bucket doesn't have enough amount", async function () {
      const borrowedAmount = parseUnits("101", decimalsA);
      const flashLoanParams = [flashLoanReceiver.address, [bucket.address, bucket2.address], [borrowedAmount, borrowedAmount], params];
      const { sortedAddresses, sortedAmounts } = sortAddressesAndAmounts(flashLoanParams[1], flashLoanParams[2]);
      flashLoanParams[1] = sortedAddresses;
      flashLoanParams[2] = sortedAmounts;
      await expect(FlashLoanManager.connect(trader).flashLoan(...flashLoanParams)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance",
      );
    });

    it("Should revert flashLoan if executeOperation return false", async function () {
      await flashLoanReceiver.setFailExecutionTransfer(true);
      await expect(FlashLoanManager.connect(trader).flashLoan(...flashLoanParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INVALID_FLASHLOAN_EXECUTOR_RETURN",
      );
    });

    it("Should revert if receiver doesn't approve sufficient allowance to flashLoanManager", async function () {
      const borrowedAmount = parseUnits("11", decimalsA);
      const flashLoanParams = [flashLoanReceiver.address, [bucket.address, bucket2.address], [borrowedAmount, borrowedAmount], params];
      const { sortedAddresses, sortedAmounts } = sortAddressesAndAmounts(flashLoanParams[1], flashLoanParams[2]);
      flashLoanParams[1] = sortedAddresses;
      flashLoanParams[2] = sortedAmounts;
      await expect(FlashLoanManager.connect(trader).flashLoan(...flashLoanParams)).to.be.revertedWith("ERC20: insufficient allowance");
    });
    it("Should revert if receiver doesn't have sufficient amount to return back", async function () {
      const borrowedAmount = parseUnits("11", decimalsA);
      const flashLoanFee = wadMul(borrowedAmount.toString(), flashLoanFeeRate.toString()).toString();
      const amountToApprove = borrowedAmount.add(flashLoanFee).mul(2);
      await flashLoanReceiver.setAmountToApprove(amountToApprove);
      const flashLoanParams = [flashLoanReceiver.address, [bucket.address, bucket2.address], [borrowedAmount, borrowedAmount], params];
      const { sortedAddresses, sortedAmounts } = sortAddressesAndAmounts(flashLoanParams[1], flashLoanParams[2]);
      flashLoanParams[1] = sortedAddresses;
      flashLoanParams[2] = sortedAmounts;
      await expect(FlashLoanManager.connect(trader).flashLoan(...flashLoanParams)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance",
      );
    });

    it("Should take flashLoan and emit event FlashLoan", async function () {
      const expectedArguments = {
        target: flashLoanReceiver.address,
        initiator: trader.address,
        asset: testTokenA.address,
        amount: borrowedAmount,
        flashLoanFee: flashLoanFee,
        flashLoanProtocolFee: feeToTreasury,
      };
      const tx = await FlashLoanManager.connect(trader).flashLoan(...flashLoanParams);
      eventValidation("FlashLoan", await tx.wait(), expectedArguments, FlashLoanManager, true);
    });

    it("Should take flashLoan without incurring any fee if initiator has FLASH_LOAN_FREE_BORROWER_ROLE", async function () {
      const expectedArguments = {
        target: flashLoanReceiver.address,
        initiator: trader.address,
        asset: testTokenA.address,
        amount: borrowedAmount,
        flashLoanFee: 0,
        flashLoanProtocolFee: 0,
      };
      await Registry.grantRole(FLASH_LOAN_FREE_BORROWER_ROLE, trader.address);
      const tx = await FlashLoanManager.connect(trader).flashLoan(...flashLoanParams);
      eventValidation("FlashLoan", await tx.wait(), expectedArguments, FlashLoanManager, true);
    });

    it("Should take flashLoan and increase balance of the bucket and treasury by a fee", async function () {
      await expect(FlashLoanManager.connect(trader).flashLoan(...flashLoanParams)).to.changeTokenBalances(
        testTokenA,
        [bucket, bucket2, Treasury],
        [feeToBucket, feeToBucket, BigNumber.from(feeToTreasury).mul(2)],
      );
    });

    it("Should correctly update liquidityIndex", async function () {
      const currentLiquidityIndex = await bucket.liquidityIndex();
      const percent = rayDiv(feeToBucket.toString(), lenderAmount.toString()).toString();
      const expectedLiquidityIndex = rayMul(BigNumber.from(percent).add(RAY.toString()).toString(), currentLiquidityIndex.toString());
      await FlashLoanManager.connect(trader).flashLoan(...flashLoanParams);
      expect(await bucket.liquidityIndex()).to.equal(expectedLiquidityIndex);
    });
  });
});
