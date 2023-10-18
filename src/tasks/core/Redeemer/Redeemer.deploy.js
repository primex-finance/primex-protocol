// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { earlyPmx, pmx, tokenTransfersLibrary, registry, errorsLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract } },
) {
  const { deployer } = await getNamedAccounts();
  if (!registry) {
    registry = (await getContract("Registry")).address;
  }
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }
  return await deploy("Redeemer", {
    from: deployer,
    args: [earlyPmx, pmx, registry],
    log: true,
    libraries: {
      TokenTransfersLibrary: tokenTransfersLibrary,
      Errors: errorsLibrary,
    },
  });
};
