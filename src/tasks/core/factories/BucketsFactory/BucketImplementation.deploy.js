// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { errorsLibrary, tokenTransfersLibrary },
  { ethers: { getContract }, deployments: { deploy }, getNamedAccounts },
) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  return await deploy("Bucket", {
    from: deployer,
    args: [],
    log: true,
    libraries: {
      Errors: errorsLibrary,
      TokenTransfersLibrary: tokenTransfersLibrary,
    },
  });
};
