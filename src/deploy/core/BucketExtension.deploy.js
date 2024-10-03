// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run, ethers: { getContract } }) => {
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const tokenApproveLibrary = await getContract("TokenApproveLibrary");

  await run("deploy:BucketExtension", {
    primexPricingLibrary: primexPricingLibrary.address,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    tokenApproveLibrary: tokenApproveLibrary.address,
  });
};
module.exports.tags = ["BucketExtension", "Test", "PrimexCore"];
module.exports.dependencies = ["PrimexPricingLibrary", "TokenTransfersLibrary", "TokenApproveLibrary"];
