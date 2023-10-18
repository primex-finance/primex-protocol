// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const errorsLibrary = await getContract("Errors");

  await run("deploy:PTokenImplementation", {
    errorsLibrary: errorsLibrary.address,
  });
};

module.exports.tags = ["PTokenImplementation", "PrimexCore"];
module.exports.dependencies = ["Errors"];
