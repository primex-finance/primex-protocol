// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName } = require("../../config/configUtils");
const { NATIVE_CURRENCY, OrderType } = require("../../test/utils/constants");
module.exports = async ({
  run,
  ethers: {
    getContract,
    utils: { parseUnits, parseEther },
    constants: { MaxUint256 },
  },
}) => {
  const PMXToken = await getContract("EPMXToken");
  const registry = await getContract("Registry");
  const Treasury = await getContract("Treasury");
  const errorsLibrary = await getContract("Errors");

  const SECONDS_PER_DAY = 24 * 60 * 60;
  const { PrimexDNSconfig } = getConfigByName("generalConfig.json");

  const delistingDelay = PrimexDNSconfig.delistingDelayInDays * SECONDS_PER_DAY;
  const adminWithdrawalDelay = PrimexDNSconfig.adminWithdrawalDelayInDays * SECONDS_PER_DAY;

  const rates = [];
  const restrictions = [];

  for (const orderType in OrderType) {
    rates.push({
      orderType: OrderType[orderType],
      feeToken: PMXToken.address,
      rate: parseUnits(PrimexDNSconfig.rates[orderType].protocolRateInPmx, 18).toString(),
    });
    rates.push({
      orderType: OrderType[orderType],
      feeToken: NATIVE_CURRENCY,
      rate: parseUnits(PrimexDNSconfig.rates[orderType].protocolRate, 18).toString(),
    });
    const minProtocolFee = PrimexDNSconfig.feeRestrictions[orderType].minProtocolFee;
    const maxProtocolFee = PrimexDNSconfig.feeRestrictions[orderType].maxProtocolFee;
    const orderRestrictions = {
      minProtocolFee: (minProtocolFee === "MaxUint256" ? MaxUint256 : parseEther(minProtocolFee)).toString(),
      maxProtocolFee: (maxProtocolFee === "MaxUint256" ? MaxUint256 : parseEther(maxProtocolFee)).toString(),
    };
    restrictions.push({ orderType: OrderType[orderType], orderRestrictions: orderRestrictions });
  }

  await run("deploy:PrimexDNS", {
    registry: registry.address,
    pmx: PMXToken.address,
    treasury: Treasury.address,
    errorsLibrary: errorsLibrary.address,
    delistingDelay: delistingDelay.toString(),
    adminWithdrawalDelay: adminWithdrawalDelay.toString(),
    rates: JSON.stringify(rates),
    restrictions: JSON.stringify(restrictions),
  });
};
module.exports.tags = ["PrimexDNS", "Test", "PrimexCore"];
module.exports.dependencies = ["Registry", "EPMXToken", "Treasury", "Errors", "PrimexProxyAdmin"];
