// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { recipient, registry, errorsLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract } },
) {
  const { epmxDeployer } = await getNamedAccounts();
  if (epmxDeployer === undefined) throw new Error("set PRIVATE_KEY_EPMX env or use mnemonic");

  if (!registry) {
    registry = (await getContract("Registry")).address;
  }
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  return await deploy("EPMXToken", {
    from: epmxDeployer,
    args: [recipient, registry],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });
};
