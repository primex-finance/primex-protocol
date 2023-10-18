// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run }) => {
  if (process.env.TEST) {
    await run("deploy:ERC20Mock", {
      name: "TestTokenA",
      symbol: "TTA",
      decimals: process.env.DECIMALS_TEST_TOKEN_A || "18",
    });
    await run("deploy:ERC20Mock", {
      name: "TestTokenB",
      symbol: "TTB",
      decimals: process.env.DECIMALS_TEST_TOKEN_B || "18",
    });
    await run("setup:MintTokens");
  }
};
module.exports.tags = ["Test", "TestTokens"];
