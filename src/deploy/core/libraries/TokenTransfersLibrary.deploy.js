// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const errorsLibrary = await getContract("Errors");
  await run("deploy:TokenTransfersLibrary", {
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["TokenTransfersLibrary", "Test","PrimexCore"];
module.exports.dependencies = ["Errors"];
