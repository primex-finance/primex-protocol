// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName } = require("../../config/configUtils"); //, getAddress, getDecimals
const { Role } = require("../../test/utils/activityRewardDistributorMath");

module.exports = async function (
  { _ },
  {
    getNamedAccounts,
    ethers: {
      getContract,
      getContractAt,
      utils: { parseUnits, formatEther, formatUnits, toUtf8Bytes, keccak256 },
      BigNumber,
    },
  },
) {
  const registry = await getContract("Registry");
  const whiteBlackList = await getContract("WhiteBlackList");
  const primexDNS = await getContract("PrimexDNS");
  // const positionManager = await getContract("PositionManager");
  const reserve = await getContract("Reserve");
  const treasury = await getContract("Treasury");
  const epmx = await getContract("EPMXToken");
  const activityRewardDistributor = await getContract("ActivityRewardDistributor");

  const { BucketsToDeprecate } = getConfigByName("generalConfig.json"); // PositionManagerConfig,

  // deprecate old buckets
  const bucketsToDeprecate = BucketsToDeprecate;
  const NO_FEE_ROLE = keccak256(toUtf8Bytes("NO_FEE_ROLE"));
  const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));

  for (const bucketAddress of bucketsToDeprecate) {
    const bucket = await getContractAt("Bucket", bucketAddress);
    const bucketName = await bucket.name();
    try {
      const deprecateBucketTx = await primexDNS.deprecateBucket(bucketName);
      await deprecateBucketTx.wait();
      console.log(`Bucket ${bucketName} is deprecated`);
    } catch (error) {
      console.error(`Error deprecating bucket ${bucketName}:`, error);
    }
    try {
      const tx = await registry.revokeRole(NO_FEE_ROLE, bucketAddress);
      await tx.wait();
      console.log(`NO_FEE_ROLE was revoked from ${bucketName}`);
    } catch (error) {
      console.error(`Error revoke NO_FEE_ROLE role from ${bucketName}:`, error);
    }
    try {
      const tx = await registry.revokeRole(VAULT_ACCESS_ROLE, bucketAddress);
      await tx.wait();
      console.log(`VAULT_ACCESS_ROLE was revoked from ${bucketName}`);
    } catch (error) {
      console.error(`Error revoke VAULT_ACCESS_ROLE role from ${bucketName}:`, error);
    }

    try {
      const tx = await whiteBlackList.removeAddressesFromWhitelist([bucketAddress, await bucket.debtToken(), await bucket.pToken()]);
      await tx.wait();
      console.log(`Address of ${bucketName} and its PToken and DebtToken was removed from whitelist`);
    } catch (error) {
      console.error(`Error remove ${bucketName} and its PToken and DebtToken from whitelist:`, error);
    }
  }

  // withdraw all pTokens from Reserve to Treasury
  const zeroTransferRestrictions = {
    minAmountToBeLeft: BigNumber.from(0),
    minPercentOfTotalSupplyToBeLeft: BigNumber.from(0),
  };
  for (let i = 0; i < bucketsToDeprecate.length; i++) {
    const bucket = await getContractAt("Bucket", bucketsToDeprecate[i]);
    const pTokenAddress = await bucket.pToken();
    const pToken = await getContractAt("PToken", pTokenAddress);
    const pTokenDecimals = await pToken.decimals();
    const reserveBalance = await pToken.balanceOf(reserve.address);
    if (reserveBalance > 0) {
      console.log("---------");
      console.log(`pToken - ${pTokenAddress}:`);
      console.log("Setting transfer restrictions to zero...");
      const setTransferRestrictionsToZeroTx = await reserve.setTransferRestrictions(pTokenAddress, zeroTransferRestrictions);
      await setTransferRestrictionsToZeroTx.wait();
      console.log("Transfer restrictions have been set to zero");
      try {
        const transferToTreasuryAllPTokensTx = await reserve.transferToTreasury(bucketsToDeprecate[i], reserveBalance);
        await transferToTreasuryAllPTokensTx.wait();
        console.log(`Withdrawn from Reserve to Treasury amount = ${formatUnits(reserveBalance, pTokenDecimals)}`);
      } catch (error) {
        console.error(`Error withdrawing from Reserve to Treasury amount = ${formatUnits(reserveBalance, pTokenDecimals)}`, error);
      }
    }
  }

  // withdraw ePMX from ActivityRewardDistributor to Treasury
  for (const bucketAddress of bucketsToDeprecate) {
    const bucket = await getContractAt("Bucket", bucketAddress);
    const bucketName = await bucket.name();
    for (const role of Object.values(Role)) {
      const bucketInfo = await activityRewardDistributor.buckets(bucketAddress, role);
      const totalReward = await bucketInfo.totalReward;
      const fixedReward = await bucketInfo.fixedReward;
      const amount = totalReward.sub(fixedReward);
      try {
        const withdrawPmxTx = await activityRewardDistributor.withdrawPmx(bucketAddress, role, amount);
        await withdrawPmxTx.wait();
        console.log(`withdrawPMX from ActivityRewardDistributor:
          bucket: ${bucketName},
          Role: ${role === Role.LENDER ? "LENDER" : "TRADER"},
          amount: ${formatEther(amount)}`);
      } catch (error) {
        console.error(
          `Error withdrawPMX from ActivityRewardDistributor;bucket: ${bucketName}, Role: ${role === Role.LENDER ? "LENDER" : "TRADER"}`,
          error,
        );
      }
    }
  }

  // set correct transferRestrictions for new buckets in Reserve
  await run("reserve:setTransferRestrictionsByConfig");

  // set actual minPositionSize in PositionManager
  // const minPositionAsset = await getAddress(PositionManagerConfig.minPositionAsset);
  // const minPositionSize = parseUnits(PositionManagerConfig.minPositionSize, await getDecimals(minPositionAsset));
  // try {
  //   const setMinPositionSizeTx = await positionManager.setMinPositionSize(minPositionSize, minPositionAsset);
  //   await setMinPositionSizeTx.wait();
  //   console.log(`Actual minPositionSize = ${PositionManagerConfig.minPositionSize} is setted`);
  // } catch (error) {
  //   console.error("Error setting minPositionSize", error);
  // }

  // set spending limits for timelocks and admin multisig in Treasury
  await run("treasury:setTreasurySpendersByConfig");

  // Add admin access in PrimexProtocol to admins from config
  // await run("setup:addAccessToConfigAdmins");

  // Add spot trading rewards with params from config
  await run("setup:SpotTradingRewardDistributor");

  // transfer all epmx from deployer to treasury
  const { deployer } = await getNamedAccounts();
  const balance = await epmx.balanceOf(deployer);
  const tx = await epmx.transfer(treasury.address, balance);
  await tx.wait();

  console.log("=== Final Params on Mainnet are setted ===");
};
