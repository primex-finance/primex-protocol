// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName } = require("../../config/configUtils");
const { NATIVE_CURRENCY, OrderType } = require("../../test/utils/constants");
module.exports = async ({
  run,
  ethers: {
    getContract,
    utils: { parseUnits },
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
  }

  await run("deploy:PrimexDNS", {
    registry: registry.address,
    pmx: PMXToken.address,
    treasury: Treasury.address,
    errorsLibrary: errorsLibrary.address,
    delistingDelay: delistingDelay.toString(),
    adminWithdrawalDelay: adminWithdrawalDelay.toString(),
    rates: JSON.stringify(rates),
  });
};
module.exports.tags = ["PrimexDNS", "Test", "PrimexCore"];
module.exports.dependencies = ["Registry", "EPMXToken", "Treasury", "Errors", "PrimexProxyAdmin"];
