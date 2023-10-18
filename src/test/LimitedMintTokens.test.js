// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  ethers: {
    getContract,
    utils: { parseEther },
    getNamedSigners,
  },
  deployments: { fixture },
  network,
} = require("hardhat");

process.env.TEST = true;
const mintingAmount = parseEther("50");
describe("LimitedMintTokens", function () {
  let testTokenA, trader, deployer, lender;

  beforeEach(async function () {
    await fixture(["TestTokens"]);
    ({ deployer, trader, lender } = await getNamedSigners());
    testTokenA = await getContract("TestTokenA");
  });

  it("Should revert when setMintTimeLimit call not owner", async function () {
    await expect(testTokenA.connect(trader).setMintTimeLimit(false)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(testTokenA.connect(trader).setMintTimeLimit(true)).to.be.revertedWith("Ownable: caller is not the owner");
  });
  describe("isTimeLimitedMinting is false", function () {
    it("Any amount of tokens should be minting to any account", async function () {
      await expect(() => testTokenA.connect(deployer).mint(deployer.address, parseEther("50"))).to.changeTokenBalance(
        testTokenA,
        deployer,
        mintingAmount,
      );
      await expect(() => testTokenA.connect(trader).mint(deployer.address, parseEther("20"))).to.changeTokenBalance(
        testTokenA,
        deployer,
        parseEther("20"),
      );
      await expect(() => testTokenA.connect(lender).mint(trader.address, parseEther("100000"))).to.changeTokenBalance(
        testTokenA,
        trader,
        parseEther("100000"),
      );
    });

    it("Should be minting regardless of the time of the last minting", async function () {
      await expect(() => testTokenA.connect(deployer).mint(deployer.address, parseEther("70"))).to.changeTokenBalance(
        testTokenA,
        deployer,
        parseEther("70"),
      );
      await expect(() => testTokenA.connect(deployer).mint(deployer.address, parseEther("30"))).to.changeTokenBalance(
        testTokenA,
        deployer,
        parseEther("30"),
      );
    });
  });

  describe("isTimeLimitedMinting is true", function () {
    beforeEach(async function () {
      await testTokenA.setMintTimeLimit(true);
    });

    it("Should minting a constant amount of tokens on sender account regardless of the injected amount and injected account", async function () {
      await expect(() => testTokenA.connect(deployer).mint(deployer.address, parseEther("50"))).to.changeTokenBalance(
        testTokenA,
        deployer,
        mintingAmount,
      );
      await expect(() => testTokenA.connect(trader).mint(deployer.address, parseEther("20"))).to.changeTokenBalance(
        testTokenA,
        trader,
        mintingAmount,
      );
      await expect(() => testTokenA.connect(lender).mint(trader.address, parseEther("100000"))).to.changeTokenBalance(
        testTokenA,
        lender,
        mintingAmount,
      );
    });

    it("Should be revert if day has not passed since last minting", async function () {
      await expect(() => testTokenA.connect(deployer).mint(deployer.address, parseEther("50"))).to.changeTokenBalance(
        testTokenA,
        deployer,
        mintingAmount,
      );
      await expect(testTokenA.connect(deployer).mint(deployer.address, parseEther("50"))).to.be.revertedWith(
        "mint tokens possible once a day",
      );
    });

    it("Should be re-minting tokens if day has passed since last minting", async function () {
      await expect(() => testTokenA.connect(deployer).mint(deployer.address, parseEther("50"))).to.changeTokenBalance(
        testTokenA,
        deployer,
        mintingAmount,
      );

      await network.provider.send("evm_increaseTime", [24 * 60 * 60]);

      await expect(() => testTokenA.connect(deployer).mint(deployer.address, parseEther("50"))).to.changeTokenBalance(
        testTokenA,
        deployer,
        mintingAmount,
      );
    });
  });
});
