// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const errorsLibrary = await getContract("Errors");

  await run("deploy:DebtTokenImplementation", {
    errorsLibrary: errorsLibrary.address,
  });
};

module.exports.tags = ["DebtTokenImplementation", "PrimexCore"];
module.exports.dependencies = ["Errors"];
