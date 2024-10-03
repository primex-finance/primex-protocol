// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  const errorsLibrary = await getContract("Errors");

  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const tokenApproveLibrary = await getContract("TokenApproveLibrary");
  await run("deploy:BucketImplementation", {
    errorsLibrary: errorsLibrary.address,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    tokenApproveLibrary: tokenApproveLibrary.address,
  });
};

module.exports.tags = ["BucketImplementation", " PrimexCore"];
module.exports.dependencies = ["Errors", "TokenTransfersLibrary", "TokenApproveLibrary", "BucketExtension"];
